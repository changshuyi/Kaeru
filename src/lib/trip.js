import { STAGES } from '../constants/app.js';

// refundMethod 這個欄位是後來才加的，舊收據沒存過這個值，要從當時的
// status 反推。只有 status 剛好停在「已登記」（STAGES 索引 1）才是
// 可靠訊號——這個 app 裡只有主動勾選「有登記退款方式」才會停在這一站。
// 一旦繼續推進到「已查驗」或「已退款」，可能是使用者自己在表單裡一路
// 點過去（那樣真的有登記），也可能是查驗頁的「全部標記為已查驗」直接
// 從「已購買」跳過去（那個動作完全不會讀退款方式，見 CheckView 的
// onVerifyAll）——兩條路徑存下來的 status 長得一樣，分不出來，這時候
// 老實回答「不確定」，不要在沒有真正依據的情況下替使用者捏造答案。
export function inferRefundMethod(initial) {
  if (!initial) return 'unsure';
  if (initial.refundMethod) return initial.refundMethod;
  return STAGES.indexOf(initial.status) === 1 ? 'registered' : 'unsure';
}

// 行程 id 原本只用 `t_${Date.now()}`，跟收據 id（`r_${Date.now()}_隨機
// 碼`）不是同一套規格——快速連續建立兩趟行程（例如快點兩下「建立」）
// 理論上可能撞出同一個毫秒、產生兩筆一樣的 id，其中一筆會變成看不到
// 也刪不掉的幽靈行程。補上跟收據 id 同一套隨機碼。
export function genTripId() {
  return `t_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}
