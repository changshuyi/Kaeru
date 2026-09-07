import { describe, it, expect } from 'vitest';
import { netOf, netOfItem } from './lib/money.js';
import { daysLeft, isPendingInfo, isExpiredUnclaimed } from './lib/date.js';
import { inferRefundMethod } from './lib/trip.js';
import {
  parseReceiptOCR,
  looksLikeReceiptText,
  reconstructRowsFromLines,
} from './lib/ocr.js';

describe('netOf / netOfItem（稅抜金額計算）', () => {
  it('用捨去、不是四捨五入——貼近店家收銀機的算法', () => {
    // 1000 / 1.1 = 909.0909...，捨去應該是 909，不是 910
    expect(netOf(1000, 10)).toBe(909);
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
    expect(isExpiredUnclaimed({ status: 'purchased', date: '2000-01-01' })).toBe(true);
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
