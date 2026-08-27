/*
  匯出／刪除功能用到的純資料邏輯，跟畫面、Capacitor 完全無關——刻意
  拆出來獨立成一個檔案，一來 App.jsx 已經夠大，二來這些都是純函式
  （吃資料吐資料，沒有副作用，唯一的例外是 collectAllPhotos 需要讀
  storage），最適合直接寫單元測試，不用整個 App 一起跑。

  這裡也把幾個原本寫在 App.jsx 裡、跟「照片/位元組」有關的小工具搬
  過來（dataUrlBytes、formatBytes、normalizePhotoList 一家、
  photoKey）——它們本來就是同一類東西，搬過來後 App.jsx 改成從這裡
  import，行為完全不變。
*/

import { zipSync, strToU8 } from 'fflate';

export const photoKey = (id) => `jptax:photo:${id}`;

// dataURL 的 base64 長度換算實際位元組數，用來顯示「1.2 MB → 240 KB」
export function dataUrlBytes(dataUrl) {
  if (!dataUrl) return 0;
  const i = dataUrl.indexOf(',');
  const b64 = i >= 0 ? dataUrl.slice(i + 1) : dataUrl;
  const pad = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
  return Math.round((b64.length * 3) / 4) - pad;
}

export function formatBytes(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

// 照片資料早期版本存的是純字串陣列（每張照片就是一個 dataURL），後來
// 改成 {src,type} 物件陣列（型別隨時可改，見照片型別功能）——讀取端
// 一律先過這一層，兩種格式都認得，不用到處重複判斷。
export function normalizePhotoEntry(p) {
  if (typeof p === 'string') return { src: p, type: 'receipt' };
  if (p && typeof p === 'object' && typeof p.src === 'string') {
    return { src: p.src, type: p.type === 'item' ? 'item' : 'receipt' };
  }
  return null;
}
export function normalizePhotoList(list) {
  return (Array.isArray(list) ? list : [])
    .map(normalizePhotoEntry)
    .filter(Boolean);
}

// 「這趟行程結束了嗎」——跟總覽那邊「已經結束，跳一次提示」的偵測
// (shouldPromptEnded) 用意不一樣：那邊是「保守偵測，全部收據都處理
// 完才問」，這裡是給刪除功能用的篩選條件，只看回程時間有沒有過，門檻
// 故意放寬——使用者會用「已結束的行程」這個選項的情境通常是「這趟
// 早就回來了，收據可能還有沒收尾的，但反正要清掉手機空間」，不該因為
// 還有一張卡在「已登記」就被排除在刪除清單外。
export function isTripEnded(trip) {
  return !!(trip && trip.departure && new Date(trip.departure).getTime() < Date.now());
}

// CSV 欄位轉義：含逗號、雙引號、換行的欄位要用雙引號包起來，裡面的
// 雙引號要變成兩個雙引號——標準 CSV 規則，Excel/Numbers/Google
// Sheets 都認這個格式。
export function csvEscape(v) {
  const s = v === null || v === undefined ? '' : String(v);
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

// 待補的欄位（金額、稅率）輸出空字串，不是 0，也不是「未填」這種給
// 人看的文字——這份檔案是要給使用者拿去記帳/報帳用的，讀 CSV 的工具
// （Excel、記帳軟體）看到空白才會正確辨識成「這格沒有值」，看到
// 「未填」會被當一個普通的文字值，看到 0 會被當成「這筆真的是 0 円」
// 直接算進總額，比空著更危險——跟這個 App 從頭到尾守的「猜錯比空著
// 更危險」是同一個原則。
export function buildCsv(items, labels) {
  const { headers, tripNameFor, stageLabelFor, refundLabelFor, mixedRateLabel } = labels;
  const rows = [
    headers,
    ...items.map((it) => [
      tripNameFor(it.tripId),
      it.shop || '',
      it.date || '',
      it.incl > 0 ? String(it.incl) : '',
      it.rate === 'mixed' ? mixedRateLabel : it.rate ? `${it.rate}%` : '',
      refundLabelFor(it.refundMethod),
      stageLabelFor(it.status),
      it.note || '',
    ]),
  ];
  // 前面加 BOM——沒有這個記號，Excel（尤其 Windows 版）讀 UTF-8 的
  // 中日文常常會判斷成別的編碼，整份表格變成亂碼。
  const text = '﻿' + rows.map((r) => r.map(csvEscape).join(',')).join('\r\n');
  return { text, bytes: new TextEncoder().encode(text).length };
}

function dataUrlToU8(dataUrl) {
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

// ZIP 用 level:0（不重新壓縮）——照片本來就已經是 JPEG，重新跑一次
// 壓縮演算法幾乎沒有效果，只是白白花時間；這也讓「這份 ZIP 大概多
// 大」的估計值（CSV 位元組數 + 所有照片位元組數，見 estimateZipBytes）
// 幾乎等於真正產出的大小，畫面上可以先給準確的數字，不用等真的壓完
// 才知道。
export function buildZip(csvText, photos) {
  const files = { 'receipts.csv': strToU8(csvText) };
  photos.forEach((p) => {
    files[`photos/${p.itemId}-${p.index + 1}.jpg`] = dataUrlToU8(p.src);
  });
  return zipSync(files, { level: 0 });
}

export function estimateZipBytes(csvBytes, photos) {
  const photoBytes = photos.reduce((s, p) => s + dataUrlBytes(p.src), 0);
  // 每個檔案的 local header + central directory record 抓一個保守的
  // 固定值，不用真的算到位元組級精準——這裡只是給使用者一個「大概
  // 多大」的心理準備，不是帳目。
  const overhead = (photos.length + 1) * 90;
  return csvBytes + photoBytes + overhead;
}

// 讀出某一批收據名下全部的照片。App.jsx 開機時已經把所有照片一次性
// 讀進記憶體（見 App 元件的 photos state，key 是 item.id），這裡直接
// 吃那份現成的資料就好，不用另外再讀一次 storage，同時給「算總大小」
// 跟「真的組 ZIP」兩邊共用。
export function collectAllPhotos(items, photosById) {
  const photos = [];
  items.forEach((it) => {
    const list = normalizePhotoList(photosById[it.id]);
    list.forEach((p, i) => photos.push({ itemId: it.id, index: i, src: p.src, type: p.type }));
  });
  return photos;
}

export function photoStatsFrom(photos) {
  return { count: photos.length, bytes: photos.reduce((s, p) => s + dataUrlBytes(p.src), 0) };
}
