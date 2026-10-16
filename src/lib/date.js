// 故意不用 toISOString()——那個是 UTC 日期，在台灣/日本這種 UTC+8/+9
// 的時區，每天凌晨到早上這段時間會被算成「昨天」，直接影響新增收據
// 預設的購買日期跟 90 天期限起算點。用 getFullYear/Month/Date 拿本機
// 時區的日期。
export const todayStr = () => {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
};
export const groupKey = (it) => `${(it.shop || '').trim()}||${it.date}`;

export function daysLeft(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr + 'T00:00:00');
  // 只檢查 dateStr 是不是空字串不夠——資料匯入或損毀時，日期欄位可能
  // 不是空的，但格式不對，new Date() 會產生 Invalid Date，後面的運算
  // 會一路是 NaN，畫面上顯示「NaN 天」而不是安全地當作沒有日期。
  if (isNaN(d.getTime())) return null;
  d.setDate(d.getDate() + 90);
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return Math.round((d - now) / 86400000);
}

// 待補：店名是空的，或金額還沒填（incl 是 0／未設）——兩個都用「資料
// 本身長什麼樣」這個天然訊號判斷，不用另外開欄位去記「這張是不是待
// 補」。店名待補是原本就有的規則：完整表單本來就規定店名必填，正常
// 流程不會存出空店名的收據，所以這個判斷不會誤判到既有資料。金額待補
// 是後來加的：快速新增現在容許「只有照片、金額晚點補」也能存（見
// QuickAddFlow），這種收據存進來時 incl 就是 0，跟已經填好金額的收據
// 用同一個「incl 是不是 0」訊號分開，一旦補上金額，這張自動不再是
// 待補狀態。兩者都待補、只有其中一個待補，都算待補——這張收據還不能
// 拿去算帳（分組、門檻判定、預估可退稅額），只要有一項沒填就是。
export function isPendingInfo(it) {
  return !it.shop || !it.shop.trim() || !it.incl;
}

// 已經超過 90 天期限、還沒真的退到錢、也不是已在境內消費（那個是另一
// 種「死掉」，有自己的樣式跟文案）的收據——跟「已在境內消費」用同一套
// 對待方式：不刪除、不隱藏，但不再算進「還沒處理」或「預估可退稅額」，
// 因為那筆錢已經拿不回來了，算進去只會讓使用者以為還有機會。
export function isExpiredUnclaimed(it) {
  // 「已查驗」（verified）跟這個 app 其他地方的既有慣例一樣，要當成
  // 錢已經到手——只排除 'refunded' 不夠，會讓已經查驗過、只是還沒
  // 手動標「已退款」的收據，一旦超過 90 天就被誤判成「來不及、拿不
  // 回來」，從 refundedTax 消失，又同時被算進「還沒處理」跳期限
  // 警示，兩邊自相矛盾。
  if (it.status === 'refunded' || it.status === 'verified' || it.consumed)
    return false;
  const d = daysLeft(it.date);
  return d !== null && d < 0;
}

/* ---------------- date picker helpers ---------------- */

export const pad2 = (n) => String(n).padStart(2, '0');
export const dateOf = (v) => (v ? v.slice(0, 10) : '');
export const timeOf = (v) => (v && v.length >= 16 ? v.slice(11, 16) : '');
