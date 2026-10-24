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
  // 收據被轉 90 度拍（橫放在桌上、手機直拿）時，OCR 還是讀得出每一行
  // 的字，但每一行的外框變成又高又窄——照原本「上下重疊算同一排」去
  // 分組，會把整張收據直的切成一條條，順序完全亂掉（實測整份文字變成
  // 一兩行的大雜燴）。外框只有水平矩形、沒有角度，看不出是往左還是往右
  // 轉，所以兩個方向都轉回來各組一次，挑「金額落在每行尾巴」比較多的
  // 那個——收據的金額欄一定在右邊，轉錯方向時金額會跑到行首。
  const long = items.filter((i) => i.text.trim().length >= 4);
  const tall = long.filter((i) => i.bottom - i.top > (i.right - i.left) * 1.5).length;
  if (long.length >= 3 && tall > long.length * 0.6) {
    // 收據上方朝右：下一行在左邊（x 變小），沿著一行往右讀是往下（y 變大）
    const cw = items.map((i) => ({ ...i, top: -i.right, bottom: -i.left, left: i.top, right: i.bottom }));
    // 收據上方朝左：下一行在右邊，沿著一行讀是往上
    const ccw = items.map((i) => ({ ...i, top: i.left, bottom: i.right, left: -i.bottom, right: -i.top }));
    const a = groupRows(cw);
    const b = groupRows(ccw);
    return amountTailScore(b) > amountTailScore(a) ? b : a;
  }
  return groupRows(items);
}

function amountTailScore(text) {
  return text.split('\n').filter((l) => /[¥￥]\s*[\d,]+\s*[)）]?\s*$/.test(l)).length;
}

function groupRows(items) {
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

// OCR 文字的前處理：全形數字/符號轉半形，再修掉 OCR 常見的「千分位逗號
// 被讀成句點」——日圓沒有小數，「¥50.566」「¥3. 500」實際上就是
// 「¥50,566」「¥3,500」。只處理緊接在 ¥ 後面的數字，不碰「10.00%」
// 這種真的帶小數點的稅率。
export function normalizeOcrText(text) {
  let s = String(text || '')
    .replace(/[０-９Ａ-Ｚａ-ｚ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[￥]/g, '¥')
    .replace(/[％]/g, '%')
    .replace(/[（]/g, '(')
    .replace(/[）]/g, ')')
    .replace(/[，]/g, ',')
    .replace(/[：]/g, ':')
    .replace(/[＠]/g, '@')
    .replace(/　/g, ' ');
  // 可能連續好幾組（¥1.234.567），重複到沒有東西可換為止
  let prev;
  do {
    prev = s;
    s = s.replace(/¥\s*([\d,]*\d)\.\s?(\d{3})(?!\d)/g, '¥$1,$2');
  } while (s !== prev);
  return s;
}

// 一行裡的所有金額。一定要有 ¥ 前綴或「円」字尾才算數（理由見
// parseReceiptOCR 裡「¥ 被誤讀成數字 4」那段），裸數字一律不認。
function amountsIn(str) {
  const out = [];
  const re = /¥\s*(\d[\d,]{0,10})|(\d[\d,]{0,10})\s*円/g;
  let m;
  while ((m = re.exec(str))) {
    const v = Number((m[1] || m[2]).replace(/,/g, ''));
    if (v > 0) out.push({ value: v, index: m.index });
  }
  return out;
}

// 含稅金額 incl 在稅率 r 之下「應該」是多少內含稅（店家收銀機多半是捨去，
// 容許差 1 円）。用來驗證 OCR 讀到的「N%対象 ¥X 内消費税 ¥Y」裡 X 跟 Y
// 是不是對得起來。
function taxMatches(incl, r, tax) {
  return Math.abs(Math.floor((incl * r) / (100 + r)) - tax) <= 1;
}

// 每個稅率的「対象」金額。真實收據的寫法五花八門，下面這些都要吃得到：
//   10%対象 1,000円              （便利商店）
//   (10%対象 ¥1,782 内消費税 ¥162)（稅率在前、¥ 前綴，後面還接內含稅）
//   外税対象額 10.00% ¥8,900       （稅率在「対象」後面、帶小數點）
//   (外税8% 対象 ¥1,150)
//   (8%内税対象 ¥1,426) / (8%軽減対象 ¥594) / (税率 8%対象額 ¥15,650)
// 一律以「行」為單位：同一行要有「対象」跟 8%/10%，金額取稅率和「対象」
// 兩者之後的第一筆；同一行如果還有第二筆金額，那是內含稅，留著驗證用。
// 「外税」行的金額是稅抜，要自己加回稅額換成含稅（App 存的是含稅金額）。
// 每個稅率只認第一筆，後面重複的不管（同一張收據常常會印兩次）。
function findRateTargets(lines) {
  const found = {};
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const ti = line.indexOf('対象') >= 0 ? line.indexOf('対象') : line.indexOf('對象');
    if (ti < 0 || /免税/.test(line)) continue;
    const rm = /(?:^|[^\d.])(8|10)(?:\.0+)?\s*%/.exec(line);
    if (!rm) continue;
    const rate = rm[1];
    if (rate in found) continue;
    const after = Math.max(ti + 2, rm.index + rm[0].length);
    let amts = amountsIn(line.slice(after));
    // 金額被 OCR 切到下一行（整行只有金額）也接受
    if (!amts.length && i + 1 < lines.length && /^\(?\s*¥/.test(lines[i + 1])) {
      amts = amountsIn(lines[i + 1]);
    }
    if (!amts.length) continue;
    const base = amts[0].value;
    const exclusive = /外税/.test(line);
    const r = Number(rate);
    found[rate] = {
      incl: exclusive ? base + Math.floor((base * r) / 100) : base,
      tax: !exclusive && amts[1] ? amts[1].value : null,
    };
  }
  return found;
}

// 「合計」金額。OCR 常見的變形也要認：「合 計」（中間有空白）、「含計」
// （合被讀成含）、只剩「合」緊接 ¥（計字沒讀到）。要排除的：「合計点数」
// （件數不是金額）、「小計」、「税合計」（那是稅額合計，例如
// 「(税合計 ¥92)」）。同一行有好幾筆金額時取最大的一筆（實測：「合計
// ¥50. ¥50.566」，前面那筆是殘字）；標籤那行沒有金額、金額單獨落在下一
// 行也接受。
function findTotal(lines) {
  const labelRe = /(合\s*計|含\s*計|お会計|ご請求金額|総\s*額|總\s*額|^合(?=\s*¥))/;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = labelRe.exec(line);
    if (!m) continue;
    const before = line.slice(Math.max(0, m.index - 1), m.index);
    if (before === '税' || before === '小') continue;
    const rest = line.slice(m.index + m[0].length);
    if (/^\s*(点|點)/.test(rest)) continue;
    let amts = amountsIn(rest);
    if (!amts.length && i + 1 < lines.length && /^\(?\s*¥/.test(lines[i + 1])) {
      amts = amountsIn(lines[i + 1]);
    }
    if (amts.length) return Math.max(...amts.map((a) => a.value));
  }
  return 0;
}

// 連「合計」那行都沒讀到時（長收據縮太小、字糊掉最常見）的備案：付款
// 那幾行（クレジット、QR、お支払…）印的通常就是同一個總額，而且常常
// 重複印好幾次。取出現最多次的金額，同次數取大的。「お預り」「現金」不
// 算——付現時那是客人給的錢，不是總額。
function findPaidTotal(lines) {
  const count = new Map();
  for (const line of lines) {
    if (!/(クレジット|カード|QR|お支払|支払額|電子マネー|PayPay|金額)/.test(line)) continue;
    if (/(預り|預かり|お釣|釣銭|現金|税|対象|免税)/.test(line)) continue;
    for (const a of amountsIn(line)) count.set(a.value, (count.get(a.value) || 0) + 1);
  }
  let best = 0;
  let bestN = 0;
  for (const [v, n] of count) {
    if (n > bestN || (n === bestN && v > best)) {
      best = v;
      bestN = n;
    }
  }
  return best;
}

// 店名。原本是「第一個沒有數字的行」，真實收據上幾乎都抓錯：Logo 殘字
// （「七」）、「領収書」、背景鍵盤上的按鍵字（「K L」「F11」）、營運
// 公司名（「株式會社パル」）。改成在收據上半部（日期那行以前）給每一行
// 打分數：先剔掉電話、店號、單一英文字母/功能鍵這類雜訊字塊，排除地址、
// 登錄番號、領收書這類一定不是店名的行；帶「店／館／ストア／カフェ…」
// 的加分，越前面的行分數越高。挑到的如果只是分店名（「キャナルシティ
// 博多店」），上一行又是一個像樣的品牌名（「3COINS+plus」），就接起來。
const SHOP_EXCLUDE =
  /(TEL|FAX|電話|登録|事業者|〒|領収|領収|レシート|様|http|www|端末|レジ|取引|担当|責No|伝票|No[.:]|ポイント|会員|お買上|お買い上げ|ありがと|有難|お越し|返品|交換|免税|TAX|※|★|START|合\s*計|小\s*計|対象|税|点数|お預り|お釣|クレジット|現金|[～!！♪]|から|ください|\d{4}\s*[年/-])/i;
const SHOP_ADDRESS = /((都|道|府|県).*(市|区|郡|町|村)|丁目|番地|\d+-\d+-\d+|^[^\s]*[市区町]\S*\d)/;
const SHOP_BONUS = /(店|館|ストア|STORE|SHOP|カフェ|CAFE|CAFFE|COFFEE|コーヒー|商店|本舗|ベーカリー|BAKERY)/i;

function cleanShopLine(line) {
  return line
    .replace(/\d{2,4}-\d{2,4}-\d{3,4}/g, ' ')
    .replace(/(?:No|Ne|NO|№)\.?\s*\d+/g, ' ')
    .split(/\s+/)
    // 單一英文字母、功能鍵（F11）、鍵盤按鍵字（option、command）、純符號——
    // 收據放在筆電鍵盤上拍時，這些都會被 OCR 讀進來混在店名那幾行
    .filter(
      (tok) =>
        tok &&
        tok.length > 1 &&
        !/^([FP][\dIOo]{1,2}|esc|option|command|shift|control|return|delete|[^A-Za-z\u3040-\u30ff\u4e00-\u9fff]+)$/i.test(
          tok,
        ),
    )
    .join(' ')
    .trim();
}

function shopCandidate(line) {
  const c = cleanShopLine(line);
  if (c.length < 2 || c.length > 30) return null;
  // 「天神渡辺通り4丁目店」這種用地名當分店名的，不能被地址規則擋掉
  if (SHOP_EXCLUDE.test(c) || (SHOP_ADDRESS.test(c) && !/店$/.test(c))) return null;
  const jp = (c.match(/[\u3040-\u30ff\u4e00-\u9fff]/g) || []).length;
  // 純英文的行要夠長才算（擋掉「Fa DII」這種背景雜訊），日文至少 2 個字
  if (jp < 2 && !/[A-Za-z]{4,}/.test(c)) return null;
  const digits = (c.match(/\d/g) || []).length;
  if (digits / c.length > 0.3) return null;
  return c;
}

function findShop(lines, dateIdx) {
  const limit = Math.min(lines.length, dateIdx >= 0 ? dateIdx : Math.max(8, Math.ceil(lines.length * 0.4)));
  let best = null;
  for (let i = 0; i < limit; i++) {
    const c = shopCandidate(lines[i]);
    if (!c) continue;
    let score = 10 - i * 0.5;
    if (SHOP_BONUS.test(c)) score += 6;
    if (/(株式会社|有限会社|\(株\))/.test(c)) score -= 8;
    if (!best || score > best.score) best = { c, i, score };
  }
  if (!best) return null;
  // Logo 常被 OCR 拆成兩行（「EXCELSIOR」「CAFFE」），也一樣接回去
  const branchOnly = /店$/.test(best.c) || /^[A-Za-z'.&]{2,8}$/.test(best.c);
  if (branchOnly && best.i > 0) {
    const prev = shopCandidate(lines[best.i - 1]);
    if (prev && !SHOP_BONUS.test(prev) && prev.length <= 20) return `${prev} ${best.c}`;
  }
  return best.c;
}

// 日期：容許 OCR 在年月日之間多塞空白（「2026年10月 1日」），月日要是
// 合理的數字——背景剛好拍到另一張收據的半截日期（「2026/10/0」）不能
// 被當成日期，跳過繼續找下一個。年份離今天太遠（實測「2026」被讀成
// 「2036」）也先跳過；整張都只有這種日期，才拿它的月日配上最近的年份
// （今年，如果那天還沒到就算去年）——收據一定是最近才拍的。
function findDate(lines, now = new Date()) {
  const re = /(20\d{2})\s*[-/.年]\s*(\d{1,2})\s*[-/.月]\s*(\d{1,2})(?!\d)/;
  const fmt = (y, mo, d) => `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const thisYear = now.getFullYear();
  let fallback = null;
  for (let i = 0; i < lines.length; i++) {
    const m = re.exec(lines[i]);
    if (!m) continue;
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const d = Number(m[3]);
    if (mo < 1 || mo > 12 || d < 1 || d > 31) continue;
    if (Math.abs(y - thisYear) <= 1) return { date: fmt(y, mo, d), idx: i };
    if (!fallback) {
      const guess = fmt(thisYear, mo, d);
      const today = fmt(thisYear, now.getMonth() + 1, now.getDate());
      fallback = { date: guess > today ? fmt(thisYear - 1, mo, d) : guess, idx: i };
    }
  }
  return fallback;
}

// 只拿到合計、沒有任何「N%対象」時的稅率：收據上有提到 8% 的稅額/對象
// 行、卻完全沒有 10%，就當 8%（外帶咖啡、便當店）；其他情況維持預設
// 10%。「※は軽減税率(8%)適用商品」這種註腳每張收據都印，不能算。
function guessRate(lines) {
  let has8 = false;
  let has10 = false;
  for (const line of lines) {
    if (!/(税|対象)/.test(line) || /(適用|商品|印は)/.test(line)) continue;
    if (/(?:^|[^\d.])8(?:\.0+)?\s*%/.test(line)) has8 = true;
    if (/(?:^|[^\d.])10(?:\.0+)?\s*%/.test(line)) has10 = true;
  }
  return has8 && !has10 ? 8 : 10;
}

export function parseReceiptOCR(text) {
  if (!text) return null;
  const lines = normalizeOcrText(text)
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (!lines.length) return null;

  const found = findRateTargets(lines);
  // 「合計」找不到才退回付款行的金額（見 findPaidTotal）
  const total = findTotal(lines) || findPaidTotal(lines);
  const rates = Object.keys(found);
  const result = {};

  if (rates.length >= 2) {
    result.rate = 'mixed';
    let i8 = found['8'].incl;
    let i10 = found['10'].incl;
    // 兩個稅率加起來對不上合計，代表其中一筆被 OCR 讀錯了（實測：
    // 「¥2,764」讀成「¥2,104」）。用同一行印的內含稅驗證：哪一筆跟自己
    // 的內含稅對不起來、而「合計減掉另一筆」對得起來，就換成後者。驗證
    // 不了（沒印內含稅）就維持讀到的數字，不亂猜。
    if (total && i8 + i10 !== total) {
      const fix = (own, other, r) => {
        const t = found[String(r)].tax;
        const cand = total - other;
        if (t && cand > 0 && !taxMatches(own, r, t) && taxMatches(cand, r, t)) return cand;
        return own;
      };
      const n8 = fix(i8, i10, 8);
      const n10 = fix(i10, i8, 10);
      if (n8 !== i8 && n10 === i10) i8 = n8;
      else if (n10 !== i10 && n8 === i8) i10 = n10;
    }
    result.incl8 = i8;
    result.incl10 = i10;
  } else if (rates.length === 1) {
    result.rate = Number(rates[0]);
    // 單一稅率時，「対象」跟「合計」理論上是同一個數字（含稅）。兩者
    // 不一樣時取大的：實測讀錯的情況都是抓到了旁邊比較小的數字——歪斜
    // 照片把「内税 ¥1,810」錯配到合計那一行，或把「軽減税率対象(8%)
    // ¥213」這種印的其實是稅額的行當成對象金額。
    result.incl = Math.max(found[rates[0]].incl, total || 0);
  } else if (total) {
    result.rate = guessRate(lines);
    result.incl = total;
  }

  const dm = findDate(lines);
  if (dm) result.date = dm.date;
  const shop = findShop(lines, dm ? dm.idx : -1);
  if (shop) result.shop = shop;

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
    const { text } = await recognizePageText(b64Src);
    return looksLikeReceiptText(text) ? 'receipt' : 'item';
  } catch (err) {
    // 辨識本身失敗（權限、原生端出錯）跟「真的不像收據」是不一樣的
    // 兩件事，沒有任何文字可以判斷時，寧可維持原本「當收據」的預設，
    // 不要因為辨識失敗就把一張可能真的是收據的照片誤標成物品照片。
    return 'receipt';
  }
}

// 一頁的辨識：原生 OCR → 有座標就用座標重組閱讀順序，沒有才退回原生
// 端接好的 text。PhotoConfirmSheet（每一頁）跟 guessPhotoType 共用。
// 失敗直接往外拋，由呼叫端決定「辨識失敗」要怎麼處理。
export async function recognizePageText(b64Src) {
  const res = await ReceiptScanner.recognizeText({ image: b64Src });
  const reconstructed = res?.lines?.length ? reconstructRowsFromLines(res.lines) : '';
  return { raw: res?.text || '', text: reconstructed || res?.text || '' };
}

// 長收據分好幾頁掃的時候，把每一頁的文字依掃描順序（由上往下）接成
// 一份再丟給 parseReceiptOCR——不是每頁各自解析再挑一個。收據的結構
// 本來就是「店名、日期在最上面，合計、稅額在最下面」，parseReceiptOCR
// 的規則也剛好是「店名找第一個像店名的行、日期找第一個日期、金額找
// 合計/対象」，接起來之後店名日期自然從第一頁抓、金額自然從最後幾頁
// 抓。各頁分開解析反而麻煩：第一頁只有店名沒有金額、最後一頁只有金額
// 但「店名」可能被誤抓成某個商品名，得另外寫一套合併規則。
// 頁跟頁之間如果拍到重疊的同一段，重複的行不影響結果——每條規則都只
// 取第一個比對到的。辨識失敗的頁（null/空字串）直接跳過。
export function mergePageTexts(texts) {
  return (texts || []).filter((x) => typeof x === 'string' && x.trim()).join('\n');
}
