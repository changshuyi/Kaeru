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
export const netOf = (incl, rate) =>
  Math.floor((incl || 0) / (1 + (rate || 10) / 100));
/* 混合稅率（8% 對象／10% 對象各一筆）：稅抜合計 = 兩段各自試算後相加，不是拿含稅總額套單一稅率 */
export const netOfItem = (it) =>
  it.rate === 'mixed'
    ? netOf(it.incl8 || 0, 8) + netOf(it.incl10 || 0, 10)
    : netOf(it.incl, it.rate);
