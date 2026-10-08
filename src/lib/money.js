export const yen = (n) => new Intl.NumberFormat('ja-JP').format(Math.round(n || 0));
export const twd = (n) =>
  new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 0 }).format(
    Math.round(n || 0),
  );
// 用 Math.floor 不是 Math.round——含稅金額換算稅抜金額，小數 ≥0.5 用
// 四捨五入會多算 1 円，多筆商品加總後剛好卡在 5,000 円門檻邊界的組合，
// 可能因為這 1-2 円的捨入差異被判定成「達標」或「未達標」，跟店家
// 收銀機實際算出來的稅抜合計不一致。日本收銀機算稅抜金額慣例本來就是
// 捨去小數，不是四捨五入，改成 floor 更貼近實際情況。
//
// 用整數運算（×100 ÷ 110），不要除以 1.1——1.1 在浮點數裡不是精確值，
// 33000 / 1.1 會算出 29999.999…，floor 之後變成 29,999，稅額多 1 円；
// 剛好落在門檻上的金額還會被誤判成「未達標」。
export const netOf = (incl, rate) =>
  Math.floor(((incl || 0) * 100) / (100 + (rate || 10)));
/* 混合稅率（8% 對象／10% 對象各一筆）：稅抜合計 = 兩段各自試算後相加，不是拿含稅總額套單一稅率 */
export const netOfItem = (it) =>
  it.rate === 'mixed'
    ? netOf(it.incl8 || 0, 8) + netOf(it.incl10 || 0, 10)
    : netOf(it.incl, it.rate);

// 這張收據理論上能退的稅額上限：含稅金額－稅抜金額。手動輸入的退稅金額
// 夾在 [0, 理論上限] 之間——打錯一個位數（例如多打一個 0）不會被吃進
// 可退稅總額、查驗頁總額這些地方。
export function taxOfItem(it) {
  const naiveTax = (it.incl || 0) - netOfItem(it);
  if (
    it.taxOverride !== null &&
    it.taxOverride !== undefined &&
    it.taxOverride !== ''
  ) {
    const override = Number(it.taxOverride) || 0;
    return Math.min(Math.max(0, override), naiveTax);
  }
  return naiveTax;
}

// 退款業者的手續費（例如固定扣 ¥320）。沒填當 0——大部分使用者結帳時
// 不會知道確切數字，不能因為沒填就把預估額算成 0。
export const feeOf = (it) => Math.max(0, Number(it.fee) || 0);

// 預估實拿：稅額扣掉手續費，不會變負數。首頁、查驗頁、收據卡這些顯示
// 「能退多少」的地方都用這個，手續費比稅額還高時就是 0。
export const refundOfItem = (it) => Math.max(0, taxOfItem(it) - feeOf(it));

// 手續費吃掉一半以上的稅額就提醒「可能不划算」——¥5,500 的消費稅約
// ¥500，扣掉 ¥320 只剩 ¥180，這種情況值得讓使用者知道，再決定要不要
// 為了這點錢在機場排隊。
export const feeHeavy = (it) => {
  const fee = feeOf(it);
  return fee > 0 && fee * 2 >= taxOfItem(it);
};
