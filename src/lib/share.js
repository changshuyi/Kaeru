import { Capacitor } from '@capacitor/core';
import { Share } from '@capacitor/share';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { utf8ToBase64, uint8ToBase64 } from './codec.js';

// 匯出檔案存好之後要「開啟系統的分享選單」——原生殼裡先寫進 Cache
// 目錄（用完即丟，不需要使用者自己管理），再交給 Share plugin 開
// 分享選單；純網頁（開發時的 vite dev server）沒有這兩個 plugin 的
// 完整實作，退回用 <a download> 直接觸發瀏覽器下載，一樣能拿到檔案，
// 只是少了分享選單那一步。
export async function shareExportedFile(filename, mimeType, data) {
  if (Capacitor.isNativePlatform()) {
    const base64 = typeof data === 'string' ? utf8ToBase64(data) : uint8ToBase64(data);
    const written = await Filesystem.writeFile({
      path: filename,
      data: base64,
      directory: Directory.Cache,
    });
    await Share.share({ files: [written.uri], dialogTitle: filename });
  } else {
    const blob = new Blob([data], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }
}
