// 搜尋比對＋標出命中片段：優先順序是機場名>城市>代碼，只標出「造成
// 這筆結果出現」的那個欄位，不會每個欄位裡出現的字都標（跟 37 號截圖
// 裡福岡空港只標名稱、北九州空港只標城市的行為一致）。
export function findMatch(text, q) {
  if (!q) return null;
  const idx = text.toLowerCase().indexOf(q.toLowerCase());
  if (idx === -1) return null;
  return { idx, len: q.length };
}
