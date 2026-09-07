import ReceiptScanner from '../receiptScanner.js';

// 從 OCR 辨識出的原始文字，抓「N%対象 金額円」這種日本收據固定格式。
// 找不到任何 %対象 就整個回傳 null——OCR 是省打字，不是猜答案，讀不到不要生數字。
// 把 OCR 回傳的每一行文字（各自帶座標）依垂直位置分組成「同一橫排」，
// 橫排內再依水平位置從左到右排好，重新拼出跟收據實際排版一致的閱讀
// 順序。原生端（ML Kit／Vision）是照它們自己切出來的文字區塊順序回傳
// 整份文字，遇到「左邊一整欄標籤、右邊一整欄金額」這種排版，常常會把
// 兩欄各自切成不同區塊，回傳順序變成「標籤全部先列完，金額才接著
// 列」，跟標籤金額原本的左右對應關係整個脫節——只給文字本身救不回來，
// 要靠座標重新配對。座標單位（像素或 0–1 正規化）兩邊平台不一樣，但
// 這裡只在同一次呼叫回來的資料裡互相比較相對位置，不需要統一單位。
export function reconstructRowsFromLines(lines) {
  if (!lines || !lines.length) return '';
  const items = lines
    .filter((l) => l && typeof l.text === 'string' && l.text.trim())
    .map((l) => ({
      text: l.text,
      top: Number(l.top) || 0,
      left: Number(l.left) || 0,
      bottom: Number(l.bottom) || 0,
      right: Number(l.right) || 0,
    }));
  if (!items.length) return '';
  items.sort((a, b) => a.top + a.bottom - (b.top + b.bottom));

  const rows = [];
  for (const item of items) {
    const height = Math.max(1, item.bottom - item.top);
    // 跟現有的每一排比，垂直範圍重疊超過這一行高度一半，就當作同一排
    // ——收據上左右兩欄、同一橫排的文字，高度通常差不多。
    let row = rows.find((r) => {
      const overlap = Math.min(r.bottom, item.bottom) - Math.max(r.top, item.top);
      return overlap > Math.min(r.bottom - r.top, height) * 0.5;
    });
    if (!row) {
      row = { top: item.top, bottom: item.bottom, items: [] };
      rows.push(row);
    }
    row.top = Math.min(row.top, item.top);
    row.bottom = Math.max(row.bottom, item.bottom);
    row.items.push(item);
  }
  rows.sort((a, b) => a.top + a.bottom - (b.top + b.bottom));
  return rows
    .map((r) =>
      r.items
        .sort((a, b) => a.left - b.left)
        .map((i) => i.text)
        .join(' '),
    )
    .join('\n');
}

export function parseReceiptOCR(text) {
  if (!text) return null;
  const norm = text.replace(/[，]/g, ',');
  const pctRe = /(8|10)\s*%\s*(?:対象|對象)[^\d]{0,12}([\d,]{2,9})\s*円/g;
  const found = {};
  let m;
  while ((m = pctRe.exec(norm))) {
    const amt = Number(m[2].replace(/,/g, ''));
    // 同一個稅率只認第一筆比對到的，後面重複的不要蓋掉。日本收據常見
    // 格式是「10%對象 1,000円」後面接一行「（內消費稅等 100円）」——
    // 後面那行也符合這個規則（"對象" 跟數字之間允許到 12 個非數字字
    // 元，"內消費稅等　" 剛好塞得進去），如果用蓋掉的方式，含稅小計
    // 會被內消費稅那個小數字取代，金額直接少一個位數；用累加的話反而
    // 會把稅額誤加回小計，一樣是錯的。第一筆抓到的通常就是真正的小計
    // 金額，後面重複比對到的不管，才是兩種收據格式都對的做法。
    if (amt > 0 && !(m[1] in found)) found[m[1]] = amt;
  }
  const rates = Object.keys(found);

  const result = {};
  if (rates.length >= 2) {
    result.rate = 'mixed';
    result.incl8 = found['8'] || null;
    result.incl10 = found['10'] || null;
  } else if (rates.length === 1) {
    result.rate = Number(rates[0]);
    result.incl = found[rates[0]];
  } else {
    // 讀不到「N%對象」這種便利商店/藥妝店式標籤——不是所有收據都會
    // 印稅率明細，退而求其次找「合計/お会計/總額」這種一般收銀機常見
    // 的總額標籤+金額，當作含稅總額，稅率不知道所以先預設 10%（較常
    // 見），存進表單後使用者自己確認調整；「合計」要排除掉「合計点數」
    // 這種列商品件數、不是列金額的行，不然會把件數誤當金額抓進來。
    // 這兩種格式都找不到，金額就先不填，但不要整個放棄——店名跟日期
    // 是完全獨立的規則，不需要靠金額才能抓，下面繼續往下走。
    //
    // 這裡曾經吃過一個虧：OCR 偶爾會把「¥」符號本身誤讀成別的字元，
    // 而且不一定是誤讀成非數字字元（那樣還好，反正間隔比對會跳過）
    // ——實測遇過直接誤讀成數字「4」，緊貼在真正金額前面，跟間隔比對
    // 允許的「任何非數字字元」混在一起，被整段吃進金額，讀出一個多一
    // 位數、完全錯誤的天文數字（「¥21,800」被讀成「421,800」）。要擋
    // 掉這個誤讀，不能只是放寬或縮窄間隔字元數，得真的比對到「¥/￥」
    // 這個符號本身才算數——如果 OCR 把 ¥ 讀壞了，寧可整條不比對成功，
    // 讀不到總比讀錯安全。這裡拆成兩種收據慣例分別處理，互不影響：
    //   1) 標籤後面直接接「¥金額」、沒有「円」字尾——一定要抓到真正
    //      的 ¥/￥ 符號才算數。
    //   2) 標籤後面接「金額円」、沒有 ¥ 符號——這種格式本來就沒有 ¥
    //      符號可以誤讀，維持原本寬鬆的間隔比對就好。
    const totalLabel = '(?:合計(?!點數|点数)|お会計|ご請求金額|總額|総額)';
    const yenPrefixRe = new RegExp(`${totalLabel}[^\\d¥￥]{0,8}[¥￥]\\s*([\\d,]{2,9})`);
    const yenSuffixRe = new RegExp(`${totalLabel}[^\\d]{0,8}([\\d,]{2,9})\\s*円`);
    const totalMatch = norm.match(yenPrefixRe) || norm.match(yenSuffixRe);
    const amt = totalMatch ? Number(totalMatch[1].replace(/,/g, '')) : 0;
    if (amt > 0) {
      result.rate = 10;
      result.incl = amt;
    }
  }

  const lines = norm
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const shopLine = lines.find((l) => l.length >= 2 && l.length <= 20 && !/\d/.test(l));
  if (shopLine) result.shop = shopLine;

  const dm = norm.match(/(20\d{2})[\-\/年](\d{1,2})[\-\/月](\d{1,2})/);
  if (dm) {
    result.date = `${dm[1]}-${String(dm[2]).padStart(2, '0')}-${String(dm[3]).padStart(2, '0')}`;
  }

  // 金額、店名、日期三個一個都沒抓到，這次辨識才算真的沒有用——回傳
  // null 讓呼叫端知道「讀不到」跟「有讀到、只是要手動補齊」是不同的
  // 兩件事。只要有抓到其中一項，就把抓到的部分帶回去，不要因為金額
  // 沒抓到就連店名/日期一起浪費掉。
  if (!result.incl && !result.incl8 && !result.incl10 && !result.shop && !result.date) {
    return null;
  }
  return result;
}

// 判斷「這張看起來像不像收據」，只用來決定要不要跳「不像收據」那個
// 分支（見 QuickAddFlow），故意做得很粗——不是要精準分類，是要抓出
// 「這張顯然不是收據」的明顯案例（例如拍到的是買到的東西本身），同時
// 放過「這是收據、只是角度/光線不好，OCR 結構化解析失敗」的情況，讓
// 那種情況照舊走「讀不到，手動補」那條路，不要被誤導去問使用者「這是
// 不是收據」。
//
// 這裡原本只看「有沒有連續 3 個數字＋至少 2 行字」，太寬鬆——任何隨機
// 數字（電話號碼、ID、時間戳、螢幕解析度）只要湊到 3 位數就會誤判成
// 「像收據」。實測踩到兩次：一次拍桌面截圖，某個視窗標題剛好有數字；
// 一次拍到螢幕上顯示的除錯 log，log 裡一段呼叫序號（9 位數）就把整
// 張誤判成收據，導致明明不是收據卻沒有跳出「不像收據」畫面。改成看
// 「數字旁邊有沒有金額符號（円/¥/%）」——這是收據排版特有的訊號，隨機
// 文字裡的數字不會剛好緊貼著這些符號；退一步再看有沒有「合計/対象」
// 這類收據關鍵字（防住標籤跟金額被 OCR 拆到不同行、抓不到緊貼符號的
// 情況）。兩個條件都沒有，才夠格說「不像收據」。
export function looksLikeReceiptText(text) {
  if (!text) return false;
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length < 2) return false;
  const hasCurrencyNumber =
    /\d[\d,]*\s*(?:円|¥|￥|%|％)/.test(text) || /(?:¥|￥)\s*[\d,]*\d/.test(text);
  const hasReceiptKeyword = /(合計|対象|對象|お会計|レシート|receipt|小計|總額|総額)/i.test(
    text,
  );
  return hasCurrencyNumber || hasReceiptKeyword;
}

// 幫「這張新照片預設要標成收據還是物品」猜一個型別——只有 QuickAddFlow
// 第一張照片會走完整的「不像收據」互動分支，其他所有加照片的地方
// （選相簿多選時第一張以外的照片、詳情頁/完整表單的「+加照片」）新
// 照片本來一律硬寫死當「收據照片」，完全沒有用到 OCR 內容去判斷——
// 實測過：食物、飲料、店面這種明顯不是收據的照片，一樣被歸類成收據
// 照片，使用者才會覺得「怎�麼都跑到收據那邊」。這裡跟 PhotoConfirmSheet
// 用同一套判斷（重組成閱讀順序、看像不像收據），只是拿掉裁切/使用者
// 互動那一段，純粹用來猜一個比「全部都當收據」合理的預設值——猜錯的話
// 使用者長按縮圖還是能改，不是最終定案。
export async function guessPhotoType(b64Src) {
  try {
    const res = await ReceiptScanner.recognizeText({ image: b64Src });
    const reconstructed = res?.lines?.length ? reconstructRowsFromLines(res.lines) : '';
    const forParse = reconstructed || res?.text || '';
    return looksLikeReceiptText(forParse) ? 'receipt' : 'item';
  } catch (err) {
    // 辨識本身失敗（權限、原生端出錯）跟「真的不像收據」是不一樣的
    // 兩件事，沒有任何文字可以判斷時，寧可維持原本「當收據」的預設，
    // 不要因為辨識失敗就把一張可能真的是收據的照片誤標成物品照片。
    return 'receipt';
  }
}
