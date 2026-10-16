import { describe, it, expect, vi } from 'vitest';
import {
  netOf,
  netOfItem,
  taxOfItem,
  feeOf,
  refundOfItem,
  feeHeavy,
} from './lib/money.js';
import { daysLeft, isPendingInfo, isExpiredUnclaimed, isOldSystem } from './lib/date.js';
import { inferRefundMethod } from './lib/trip.js';
import {
  parseReceiptOCR,
  looksLikeReceiptText,
  reconstructRowsFromLines,
  mergePageTexts,
} from './lib/ocr.js';
import { fitScale } from './lib/image.js';

describe('netOf / netOfItem（稅抜金額計算）', () => {
  it('用捨去、不是四捨五入——貼近店家收銀機的算法', () => {
    // 1000 / 1.1 = 909.0909...，捨去應該是 909，不是 910
    expect(netOf(1000, 10)).toBe(909);
  });
  it('整除的金額不能被浮點誤差少算 1 円（33000 / 1.1 = 29999.999…）', () => {
    expect(netOf(33000, 10)).toBe(30000);
    expect(netOf(5500, 10)).toBe(5000);
    expect(netOf(5400, 8)).toBe(5000);
    // 掃一輪：稅抜 n 是 10 的倍數時含稅剛好是整數，換回來一定要拿回 n
    for (let n = 10; n <= 300000; n += 10) {
      if (netOf((n / 10) * 11, 10) !== n) throw new Error(`netOf 錯在 ${n}`);
    }
  });
  it('沒給稅率預設當 10%——跟明確傳 10 的結果要一樣', () => {
    expect(netOf(1100, undefined)).toBe(netOf(1100, 10));
  });
  it('混合稅率：兩段分開算再加總，不是拿含稅總額套單一稅率', () => {
    const it_ = { rate: 'mixed', incl8: 1080, incl10: 1100 };
    expect(netOfItem(it_)).toBe(netOf(1080, 8) + netOf(1100, 10));
  });
  it('單一稅率直接吃 incl/rate，結果跟直接呼叫 netOf 一致', () => {
    expect(netOfItem({ rate: 10, incl: 1100 })).toBe(netOf(1100, 10));
  });
});

describe('daysLeft（90 天期限倒數）', () => {
  it('空字串回 null，不是 NaN', () => {
    expect(daysLeft('')).toBeNull();
  });
  it('格式不對的日期回 null，不會讓後面算出 NaN 天', () => {
    expect(daysLeft('not-a-date')).toBeNull();
  });
  it('90 天後的日期算出來剩 0 天', () => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const d = new Date(today);
    d.setDate(d.getDate() - 90);
    const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    expect(daysLeft(dateStr)).toBe(0);
  });
});

describe('isPendingInfo（店名或金額待補）', () => {
  it('店名跟金額都有 → 不算待補', () => {
    expect(isPendingInfo({ shop: 'ABC', incl: 1000 })).toBe(false);
  });
  it('店名是空字串 → 待補', () => {
    expect(isPendingInfo({ shop: '', incl: 1000 })).toBe(true);
  });
  it('店名只有空白 → 待補（trim 之後是空的）', () => {
    expect(isPendingInfo({ shop: '   ', incl: 1000 })).toBe(true);
  });
  it('金額是 0 → 待補（快速新增允許先存、金額晚點補）', () => {
    expect(isPendingInfo({ shop: 'ABC', incl: 0 })).toBe(true);
  });
});

describe('isExpiredUnclaimed（超過期限又沒退成的收據）', () => {
  it('已退款的不算「過期沒救」——已經拿到錢了', () => {
    expect(isExpiredUnclaimed({ status: 'refunded', date: '2000-01-01' })).toBe(false);
  });
  it('已查驗的不算——查驗完等於錢已經到手，跟已退款同一套待遇', () => {
    expect(isExpiredUnclaimed({ status: 'verified', date: '2000-01-01' })).toBe(false);
  });
  it('已在境內消費的不算——那是另一種「死掉」，有自己的樣式', () => {
    expect(isExpiredUnclaimed({ status: 'purchased', consumed: true, date: '2000-01-01' })).toBe(false);
  });
  it('還卡在待處理、日期超過 90 天 → 算過期沒救', () => {
    // 新制 11/1 才上路，要有「超過 90 天的新制收據」得把時間撥到明年；
    // 2000-01-01 這種日期現在會被當成舊制，不會過期。
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2027-03-01T12:00:00'));
    try {
      expect(isExpiredUnclaimed({ status: 'purchased', date: '2026-11-15' })).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
  it('還沒到期的不算', () => {
    const future = new Date();
    future.setDate(future.getDate() + 1);
    const s = `${future.getFullYear()}-${String(future.getMonth() + 1).padStart(2, '0')}-${String(future.getDate()).padStart(2, '0')}`;
    expect(isExpiredUnclaimed({ status: 'purchased', date: s })).toBe(false);
  });
});

describe('inferRefundMethod（從舊資料的 status 反推退款方式）', () => {
  it('沒有初始資料（新增收據）→ 不確定', () => {
    expect(inferRefundMethod(null)).toBe('unsure');
  });
  it('status 剛好停在「已登記」→ 有登記', () => {
    expect(inferRefundMethod({ status: 'registered' })).toBe('registered');
  });
  it('status 已經推進到已查驗/已退款 → 沒有可靠依據，答不確定，不能瞎猜', () => {
    expect(inferRefundMethod({ status: 'verified' })).toBe('unsure');
    expect(inferRefundMethod({ status: 'refunded' })).toBe('unsure');
  });
  it('status 還在已購買 → 還沒登記，不確定', () => {
    expect(inferRefundMethod({ status: 'purchased' })).toBe('unsure');
  });
});

describe('parseReceiptOCR（OCR 文字結構化解析）', () => {
  it('讀到「N%對象 金額円」格式，抓出稅率跟金額', () => {
    const text = '10%対象 1,000円';
    expect(parseReceiptOCR(text)).toMatchObject({ rate: 10, incl: 1000 });
  });
  it('8% 和 10% 都讀到 → rate 是 mixed，兩個金額分開存', () => {
    const text = '8%対象 500円\n10%対象 1,000円';
    expect(parseReceiptOCR(text)).toMatchObject({ rate: 'mixed', incl8: 500, incl10: 1000 });
  });
  it('同一稅率出現兩次（小計+內消費稅等）只認第一筆，不會被較小的內稅金額蓋掉', () => {
    const text = '10%対象 1,000円\n（内消費税等　90円）';
    expect(parseReceiptOCR(text).incl).toBe(1000);
  });
  it('讀不到 %對象 格式，退而求其次找「合計」+ 金額，稅率先預設 10%', () => {
    const text = '合計　3,300円';
    expect(parseReceiptOCR(text)).toMatchObject({ rate: 10, incl: 3300 });
  });
  it('「合計點數」不是金額，不能被誤當成合計金額抓進去', () => {
    const text = '合計點數　5\n合計　1,000円';
    expect(parseReceiptOCR(text).incl).toBe(1000);
  });
  it('¥ 符號被 OCR 誤讀成緊貼的數字時，寧可整條讀不到，不要讀出多一位數的錯誤金額', () => {
    // 模擬「¥21,800」的 ¥ 被誤讀成數字「4」，變成「421,800」——沒有真正
    // 的 ¥/￥ 符號、也沒有「円」字尾，這個規則要整條不比對成功。這一行
    // 也沒有其他可抓的店名/日期，整體結果會是 null（真的讀不到，不是
    // 讀出一個錯誤的天文數字）。
    const text = '合計 421,800';
    expect(parseReceiptOCR(text)).toBeNull();
  });
  it('店名跟日期抓取失敗不該拖累彼此——三項各自獨立，抓到什麼就帶什麼回去', () => {
    const text = 'SOME SHOP\n2026-06-13';
    const result = parseReceiptOCR(text);
    expect(result.shop).toBe('SOME SHOP');
    expect(result.date).toBe('2026-06-13');
    expect(result.incl).toBeUndefined();
  });
  it('金額、店名、日期都抓不到 → 回傳 null（真的讀不到，不是部分結果）', () => {
    expect(parseReceiptOCR('###### 12345 ######')).toBeNull();
  });
  it('空字串/null 直接回 null', () => {
    expect(parseReceiptOCR('')).toBeNull();
    expect(parseReceiptOCR(null)).toBeNull();
  });
});

describe('looksLikeReceiptText（粗略判斷像不像收據，防「¥0」bug 的變體）', () => {
  it('真的收據文字（金額緊貼円/¥符號）→ true——至少要有 2 行才夠格判斷', () => {
    expect(looksLikeReceiptText('たばこ\n500円')).toBe(true);
  });
  it('只有一行文字，不管內容是什麼，一律 false——單行不夠格判斷', () => {
    expect(looksLikeReceiptText('たばこ 500円')).toBe(false);
  });
  it('有合計/対象等關鍵字 → true，即使符號被拆到別行', () => {
    expect(looksLikeReceiptText('合計\n1000')).toBe(true);
  });
  it('少於 2 行的文字直接判定不像收據', () => {
    expect(looksLikeReceiptText('只有一行')).toBe(false);
  });
  it('迴歸案例：桌面截圖抓到的視窗文字（"CLAUDE"）不該被誤判成收據', () => {
    const text = 'CLAUDE\n設定\n檔案\n編輯';
    expect(looksLikeReceiptText(text)).toBe(false);
  });
  it('迴歸案例：房間照片抓到的產品名稱字樣不該被誤判成收據', () => {
    const text = 'Avène\nerave\n保濕系列';
    expect(looksLikeReceiptText(text)).toBe(false);
  });
  it('迴歸案例：devtools log 洩漏出的呼叫序號（純數字，沒有金額符號）不該被誤判成收據', () => {
    const text = 'gos四e.oeeeoe@\nnative Camera.getPhoto (033547361)';
    expect(looksLikeReceiptText(text)).toBe(false);
  });
  it('空字串/null 一律 false', () => {
    expect(looksLikeReceiptText('')).toBe(false);
    expect(looksLikeReceiptText(null)).toBe(false);
  });
});

describe('reconstructRowsFromLines（座標重組成閱讀順序）', () => {
  it('把同一橫排、左右分開的兩塊文字重新接在一起', () => {
    const lines = [
      { text: '合計', top: 0, bottom: 10, left: 0, right: 20 },
      { text: '1000円', top: 1, bottom: 11, left: 100, right: 150 },
    ];
    expect(reconstructRowsFromLines(lines)).toBe('合計 1000円');
  });
  it('垂直位置不重疊的兩塊文字算不同排，各自一行、依上下順序排好', () => {
    const lines = [
      { text: '第二行', top: 50, bottom: 60, left: 0, right: 20 },
      { text: '第一行', top: 0, bottom: 10, left: 0, right: 20 },
    ];
    expect(reconstructRowsFromLines(lines)).toBe('第一行\n第二行');
  });
  it('空陣列/沒有文字內容的項目回空字串，不拋錯', () => {
    expect(reconstructRowsFromLines([])).toBe('');
    expect(reconstructRowsFromLines(null)).toBe('');
    expect(reconstructRowsFromLines([{ text: '  ' }])).toBe('');
  });
});

describe('isOldSystem（新舊制看購買日期）', () => {
  it('10/31 買的是舊制', () => {
    expect(isOldSystem({ date: '2026-10-31' })).toBe(true);
  });
  it('11/1 起買的是新制', () => {
    expect(isOldSystem({ date: '2026-11-01' })).toBe(false);
    expect(isOldSystem({ date: '2027-01-15' })).toBe(false);
  });
  it('沒日期或格式不對當新制，不猜成比較特殊的那一種', () => {
    expect(isOldSystem({ date: '' })).toBe(false);
    expect(isOldSystem({ date: 'not-a-date' })).toBe(false);
    expect(isOldSystem(null)).toBe(false);
  });
  it('舊制收據就算超過 90 天也不算「過期沒退到」', () => {
    expect(
      isExpiredUnclaimed({ date: '2026-01-01', status: 'purchased', consumed: false }),
    ).toBe(false);
  });
});

describe('手續費（taxOfItem / refundOfItem / feeHeavy）', () => {
  const base = { incl: 5500, rate: 10 }; // 稅抜 5000、稅 500
  it('沒填手續費，實拿等於稅額', () => {
    expect(taxOfItem(base)).toBe(500);
    expect(refundOfItem(base)).toBe(500);
  });
  it('影片的例子：¥5,500 扣 ¥320 只剩 ¥180', () => {
    expect(refundOfItem({ ...base, fee: 320 })).toBe(180);
  });
  it('手續費比稅額高，實拿是 0 不是負數', () => {
    expect(refundOfItem({ ...base, fee: 800 })).toBe(0);
  });
  it('手動覆寫的稅額也會先夾在理論上限再扣手續費', () => {
    expect(refundOfItem({ ...base, taxOverride: 9999, fee: 100 })).toBe(400);
  });
  it('負數或亂填的手續費當 0', () => {
    expect(feeOf({ fee: -5 })).toBe(0);
    expect(feeOf({ fee: 'abc' })).toBe(0);
    expect(feeOf({})).toBe(0);
  });
  it('手續費吃掉一半以上才算偏高', () => {
    expect(feeHeavy({ ...base, fee: 320 })).toBe(true);
    expect(feeHeavy({ ...base, fee: 250 })).toBe(true);
    expect(feeHeavy({ ...base, fee: 249 })).toBe(false);
    expect(feeHeavy(base)).toBe(false);
  });
});

describe('fitScale（長收據縮圖不能壓到看不清楚）', () => {
  const dims = (w, h, max) => {
    const k = fitScale(w, h, max);
    return [Math.round(w * k), Math.round(h * k)];
  };
  it('一般 3:4 手機照片跟以前一樣：最長邊 1000', () => {
    expect(dims(3000, 4000, 1000)).toEqual([750, 1000]);
    expect(dims(4000, 3000, 1000)).toEqual([1000, 750]);
  });
  it('小圖不放大', () => {
    expect(fitScale(400, 600, 1000)).toBe(1);
  });
  it('1:6 長收據寬度保留 350px 以上（以前只剩 167px）', () => {
    const [w, h] = dims(1000, 6000, 1000);
    expect(w).toBeGreaterThanOrEqual(350);
    expect(h).toBeLessThanOrEqual(4000);
  });
  it('像素數不超過一張 3:4 照片的上限，最長邊不超過 4 倍', () => {
    for (const [w, h] of [[1000, 2000], [1000, 6000], [800, 9000], [500, 20000]]) {
      const [ow, oh] = dims(w, h, 1000);
      expect(ow * oh).toBeLessThanOrEqual(750000 * 1.01);
      expect(Math.max(ow, oh)).toBeLessThanOrEqual(4000);
    }
  });
});

describe('mergePageTexts（長收據分段掃描）', () => {
  it('店名日期從第一頁、金額從最後一頁，接起來一起解析', () => {
    const page1 = 'ドラッグストアABC\n2026年11月05日 14:32\nロキソニン 1,078円';
    const page2 = '化粧水 3,300円\n乳液 2,970円';
    const page3 = '10%対象 7,348円\n(内消費税等 668円)\n合計 ¥7,348';
    const parsed = parseReceiptOCR(mergePageTexts([page1, page2, page3]));
    expect(parsed).toMatchObject({
      shop: 'ドラッグストアABC',
      date: '2026-11-05',
      rate: 10,
      incl: 7348,
    });
    // 只讀第一頁（以前的行為）抓不到金額
    expect(parseReceiptOCR(page1).incl).toBeUndefined();
  });
  it('辨識失敗的頁（null/空字串）直接跳過', () => {
    expect(mergePageTexts(['a', null, '', '  ', 'b'])).toBe('a\nb');
    expect(mergePageTexts([])).toBe('');
  });
});

// 下面的文字都是真實收據（2026/9～10 福岡、佐賀、熊本）拍照後 OCR 讀出來的
// 樣子，只留跟解析有關的幾行，連 OCR 讀錯的字也照原樣保留。
describe('parseReceiptOCR：真實收據格式', () => {
  it('「(10%対象 ¥1,782 内消費税 ¥162)」¥ 前綴、混合稅率', () => {
    const text = [
      '中川政七商店 アミュプラサ博多店',
      '2026-10-02 18:05:25',
      '合計 ¥4,546',
      '(10%対象¥1,782内消費税 ¥162)',
      '(8%対象 ¥2,764 内消費税 ¥204)',
    ].join('\n');
    expect(parseReceiptOCR(text)).toMatchObject({ rate: 'mixed', incl8: 2764, incl10: 1782 });
  });
  it('混合稅率其中一筆被 OCR 讀錯（¥2,764→¥2,104），用合計跟同一行的內含稅修回來', () => {
    const text = '合計 ¥4,546\n(10%対象¥1,782内消費税 ¥162)\n(8%対象 ¥2,104 内消費税 ¥204)';
    expect(parseReceiptOCR(text)).toMatchObject({ incl8: 2764, incl10: 1782 });
  });
  it('外税：「外税対象額 10.00% ¥8,900」是稅抜，要換成含稅', () => {
    const text = '小 計 ¥8,900\n外税対象額 10.00% ¥8,900\n外税 10.00% ¥890\n合計 ¥9,790';
    expect(parseReceiptOCR(text)).toMatchObject({ rate: 10, incl: 9790 });
  });
  it('「(税合計 ¥92)」是稅額，不能當成合計', () => {
    const text = '小計 ¥1,150\n(外税8% 対象 ¥1,150)\n外税8% ¥92\n(税合計 ¥92)\n合計 ¥1,242';
    expect(parseReceiptOCR(text)).toMatchObject({ rate: 8, incl: 1242 });
  });
  it('「8%内税対象」「合 計」中間有空白、只剩「合」', () => {
    const text = '(8%内税対象 ¥1,426)\n(8%内税額 ¥105)\n(10%内税対象 ¥50)\n(10%内税額 ¥4)\n合 ¥1,476';
    expect(parseReceiptOCR(text)).toMatchObject({ rate: 'mixed', incl8: 1426, incl10: 50 });
  });
  it('「軽減税率対象(8%) ¥213」印的其實是稅額：單一稅率時以合計為準', () => {
    const text = '小計 ¥2,673\nA軽減税率対象(8%)(8%) ¥213\n合計 ¥2,886';
    expect(parseReceiptOCR(text)).toMatchObject({ rate: 8, incl: 2886 });
  });
  it('歪斜照片把合計錯配到旁邊的稅額，対象金額比較大就用対象', () => {
    const text = '内税対象額 10.00% ¥19,910\n含計 ¥1,810\n¥19,910';
    expect(parseReceiptOCR(text)).toMatchObject({ rate: 10, incl: 19910 });
  });
  it('「¥50.566」逗號被讀成句點；同一行有殘字金額時取最大的', () => {
    expect(parseReceiptOCR('合計 ¥50. ¥50.566').incl).toBe(50566);
  });
  it('長收據連「合計」都沒讀到：改用付款行重複出現的金額', () => {
    const text = '¥50,566\n(内、消費税等 ¥50.\nクレジット(他クレ) ¥50,566\n今回お預り額 ¥50,566\n額 ¥50,566';
    expect(parseReceiptOCR(text)).toMatchObject({ rate: 10, incl: 50566 });
  });
  it('只有 8% 的稅額行、沒有 10% → 稅率猜 8%；註腳「軽減税率(8%)適用商品」不算', () => {
    expect(parseReceiptOCR('合計 ¥15,650\n(内消費税等 8% ¥1,159)').rate).toBe(8);
    expect(parseReceiptOCR('合計 ¥2,469\n※は軽減税率(8%)適用商品').rate).toBe(10);
  });
  it('日期：年月日之間有空白、月日不合理的跳過、年份讀錯的配最近的年份', () => {
    expect(parseReceiptOCR('2026年10月 1日(木) 15:03').date).toBe('2026-10-01');
    expect(parseReceiptOCR('2026/10/0\n2026年10月02日(金)12:25').date).toBe('2026-10-02');
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-16T12:00:00'));
    try {
      expect(parseReceiptOCR('2036年 9月27日(日)15:03').date).toBe('2026-09-27');
    } finally {
      vi.useRealTimers();
    }
  });
  it('店名：跳過 Logo 殘字、領収書、鍵盤雜訊，優先帶「店」的行，品牌跟分店接起來', () => {
    expect(parseReceiptOCR('七\n中川政七商店 アミュプラサ博多店\nTEL:092-409-6807').shop).toBe(
      '中川政七商店 アミュプラサ博多店',
    );
    expect(parseReceiptOCR('3COINS+plus\nキャナルシティ博多店 №3070\nTEL 092-402-7767\n領').shop).toBe(
      '3COINS+plus キャナルシティ博多店',
    );
    expect(parseReceiptOCR('FIO P11 P12\nK L DACOMECCA\nDACOMECCA 092-477-1050').shop).toBe('DACOMECCA');
    expect(parseReceiptOCR('EXCELSIOR\nCAFFE\n天神渡辺通り4丁目店\n092-260-3556').shop).toBe('EXCELSIOR CAFFE');
    expect(parseReceiptOCR('ONE PIECE\n領収書\nONE PIECE 麦わらストア熊本店').shop).toBe('ONE PIECE 麦わらストア熊本店');
  });
});

describe('reconstructRowsFromLines：轉 90 度拍的收據', () => {
  // 收據上方朝右：每一行在照片裡是一條直的，下一行在左邊
  const rotated = [
    { text: 'TULLY\'S COFFEE', left: 0.9, right: 0.93, top: 0.1, bottom: 0.4 },
    { text: '2026年09月30日(水)', left: 0.8, right: 0.83, top: 0.1, bottom: 0.45 },
    { text: '(8%対象', left: 0.7, right: 0.73, top: 0.1, bottom: 0.25 },
    { text: '¥510)', left: 0.7, right: 0.73, top: 0.7, bottom: 0.8 },
    { text: '合計', left: 0.6, right: 0.63, top: 0.1, bottom: 0.2 },
    { text: '¥510', left: 0.6, right: 0.63, top: 0.7, bottom: 0.8 },
  ];
  it('轉回正確方向、同一行的標籤跟金額接在一起', () => {
    expect(reconstructRowsFromLines(rotated)).toBe(
      "TULLY'S COFFEE\n2026年09月30日(水)\n(8%対象 ¥510)\n合計 ¥510",
    );
  });
  it('往另一個方向轉（上方朝左）也一樣', () => {
    const ccw = rotated.map((l) => ({ ...l, left: 1 - l.right, right: 1 - l.left, top: 1 - l.bottom, bottom: 1 - l.top }));
    expect(reconstructRowsFromLines(ccw)).toBe("TULLY'S COFFEE\n2026年09月30日(水)\n(8%対象 ¥510)\n合計 ¥510");
  });
});
