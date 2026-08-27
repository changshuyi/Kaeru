// e2e 測試共用的小工具——主要是「怎麼把資料塞進 localStorage」跟
// 「一張最小可用的測試圖片」，各個 spec 檔案重複用到，集中在這裡
// 改一次全部生效。

// 1×1 的透明 PNG，dataURL 格式——任何需要「一張真的圖片」的測試都
// 可以直接用這個，不需要真的收據照片，內容跟測試邏輯無關。
export const TINY_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

// 用 page.addInitScript 而不是 page.evaluate——addInitScript 保證在
// App 自己的程式碼跑之前就把 localStorage 寫好，避免跟 App 開機時
// 「沒有資料就自動建一個空行程」的效果搶跑（那個race 曾經在這個
// session 裡真的發生過：evaluate 寫得比 App 的效果晚一個 tick，資料
// 被悄悄蓋掉）。
export async function seedTrip(page, { items = [], trips = [], activeId = null, photos = {} } = {}) {
  await page.addInitScript(
    ({ items, trips, activeId, photos }) => {
      localStorage.setItem(
        'kaeru:jptax:v2',
        JSON.stringify({ items, settings: { rate: 0.21, lang: 'zh' }, trips, activeId }),
      );
      for (const [id, list] of Object.entries(photos)) {
        localStorage.setItem(`kaeru:jptax:photo:${id}`, JSON.stringify(list));
      }
    },
    { items, trips, activeId, photos },
  );
}
