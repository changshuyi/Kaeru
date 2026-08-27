import { describe, it, expect } from 'vitest';
import {
  csvEscape,
  buildCsv,
  buildZip,
  estimateZipBytes,
  isTripEnded,
  normalizePhotoEntry,
  normalizePhotoList,
  dataUrlBytes,
  formatBytes,
  collectAllPhotos,
  photoStatsFrom,
} from './exportData.js';

const TINY_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

describe('csvEscape', () => {
  it('留原樣不需要引號的欄位', () => {
    expect(csvEscape('ヨドバシ梅田')).toBe('ヨドバシ梅田');
  });
  it('含逗號的欄位要包雙引號', () => {
    expect(csvEscape('備註,測試')).toBe('"備註,測試"');
  });
  it('含雙引號的欄位要把雙引號變成兩個——中日文的「」是普通字元，不算', () => {
    expect(csvEscape('他說"你好"')).toBe('"他說""你好"""');
  });
  it('null/undefined 當成空字串', () => {
    expect(csvEscape(null)).toBe('');
    expect(csvEscape(undefined)).toBe('');
  });
});

describe('buildCsv', () => {
  const labels = {
    headers: ['行程', '店名', '日期', '含稅金額', '稅率', '退款方式', '狀態', '備註'],
    tripNameFor: (id) => (id === 't1' ? '大阪出差' : '未命名行程'),
    stageLabelFor: (s) => ({ purchased: '已購買', registered: '已登記', verified: '已查驗', refunded: '已退款' })[s] || '',
    refundLabelFor: (m) => ({ registered: '有登記', no: '沒有', unsure: '不確定' })[m] || '',
    mixedRateLabel: '8%+10%',
  };

  it('待補的金額欄位輸出空字串，不是 0——空白和零是兩件事', () => {
    const items = [{ tripId: 't1', shop: '', date: '2026-06-14', incl: 0, rate: null, refundMethod: 'unsure', status: 'purchased', note: '' }];
    const { text } = buildCsv(items, labels);
    const dataRow = text.split('\r\n')[1];
    // incl 那一格（第 4 欄）跟 rate 那一格（第 5 欄）都要是空的
    const cols = dataRow.split(',');
    expect(cols[3]).toBe('');
    expect(cols[4]).toBe('');
  });

  it('混合稅率輸出成 8%+10%，不是單一數字', () => {
    const items = [{ tripId: 't1', shop: 'DONKI', date: '2025-01-05', incl: 5500, rate: 'mixed', refundMethod: 'registered', status: 'refunded', note: '' }];
    const { text } = buildCsv(items, labels);
    expect(text).toContain('8%+10%');
  });

  it('含逗號的備註欄位在完整一行裡正確包住', () => {
    const items = [{ tripId: 't1', shop: 'A', date: '2026-01-01', incl: 100, rate: 10, refundMethod: 'no', status: 'purchased', note: '備註,有逗號' }];
    const { text } = buildCsv(items, labels);
    expect(text).toContain('"備註,有逗號"');
  });

  it('前面帶 BOM，避免 Excel 讀成亂碼', () => {
    const { text } = buildCsv([], labels);
    expect(text.charCodeAt(0)).toBe(0xfeff);
  });

  it('bytes 是用 UTF-8 編碼算出來的實際位元組數', () => {
    const items = [{ tripId: 't1', shop: 'ヨドバシ梅田', date: '2026-01-01', incl: 100, rate: 10, refundMethod: 'no', status: 'purchased', note: '' }];
    const { text, bytes } = buildCsv(items, labels);
    expect(bytes).toBe(new TextEncoder().encode(text).length);
  });
});

describe('isTripEnded', () => {
  it('回程時間在過去 → 已結束', () => {
    expect(isTripEnded({ departure: '2020-01-01T00:00:00' })).toBe(true);
  });
  it('回程時間在未來 → 還沒結束', () => {
    expect(isTripEnded({ departure: '2999-01-01T00:00:00' })).toBe(false);
  });
  it('沒有回程時間 → 不算已結束（不知道就不算，不要猜）', () => {
    expect(isTripEnded({ departure: '' })).toBe(false);
    expect(isTripEnded({})).toBe(false);
    expect(isTripEnded(null)).toBe(false);
  });
});

describe('normalizePhotoEntry / normalizePhotoList', () => {
  it('舊格式（純字串）自動補上 type: receipt', () => {
    expect(normalizePhotoEntry('data:image/png;base64,abc')).toEqual({
      src: 'data:image/png;base64,abc',
      type: 'receipt',
    });
  });
  it('新格式保留原本的 type', () => {
    expect(normalizePhotoEntry({ src: 'x', type: 'item' })).toEqual({ src: 'x', type: 'item' });
  });
  it('type 不是 item 的一律當 receipt（防呆，不是白名單就當預設值）', () => {
    expect(normalizePhotoEntry({ src: 'x', type: 'garbage' })).toEqual({ src: 'x', type: 'receipt' });
  });
  it('壞資料回傳 null，被 normalizePhotoList 濾掉', () => {
    expect(normalizePhotoEntry(123)).toBeNull();
    expect(normalizePhotoEntry(null)).toBeNull();
    expect(normalizePhotoList([1, 'a', { src: 'b', type: 'item' }, null])).toEqual([
      { src: 'a', type: 'receipt' },
      { src: 'b', type: 'item' },
    ]);
  });
  it('不是陣列也不會炸，回空陣列', () => {
    expect(normalizePhotoList(null)).toEqual([]);
    expect(normalizePhotoList(undefined)).toEqual([]);
  });
});

describe('dataUrlBytes / formatBytes', () => {
  it('data URL 算出來的位元組數跟 base64 解出來的長度一致', () => {
    const b64 = TINY_PNG.slice(TINY_PNG.indexOf(',') + 1);
    const decoded = atob(b64);
    expect(dataUrlBytes(TINY_PNG)).toBe(decoded.length);
  });
  it('空字串回 0，不拋錯', () => {
    expect(dataUrlBytes('')).toBe(0);
    expect(dataUrlBytes(null)).toBe(0);
  });
  it('formatBytes 三個量級都正確換算', () => {
    expect(formatBytes(500)).toBe('500 B');
    expect(formatBytes(2048)).toBe('2 KB');
    expect(formatBytes(3 * 1024 * 1024)).toBe('3.0 MB');
  });
});

describe('collectAllPhotos / photoStatsFrom', () => {
  const items = [{ id: 'r1' }, { id: 'r2' }, { id: 'r3' }];
  const photosById = {
    r1: [{ src: TINY_PNG, type: 'receipt' }],
    r2: [{ src: TINY_PNG, type: 'item' }, { src: TINY_PNG, type: 'item' }],
    // r3 沒有照片
  };

  it('把每張收據的照片攤平成一個陣列，各自記著是哪張收據第幾張', () => {
    const photos = collectAllPhotos(items, photosById);
    expect(photos).toHaveLength(3);
    expect(photos.filter((p) => p.itemId === 'r2')).toHaveLength(2);
    expect(photos.filter((p) => p.itemId === 'r3')).toHaveLength(0);
  });

  it('photoStatsFrom 算出正確的張數跟總位元組數', () => {
    const photos = collectAllPhotos(items, photosById);
    const stats = photoStatsFrom(photos);
    expect(stats.count).toBe(3);
    expect(stats.bytes).toBe(dataUrlBytes(TINY_PNG) * 3);
  });

  it('沒有任何照片時回傳 0，不是 undefined/NaN', () => {
    const stats = photoStatsFrom(collectAllPhotos([{ id: 'x' }], {}));
    expect(stats).toEqual({ count: 0, bytes: 0 });
  });
});

describe('buildZip / estimateZipBytes', () => {
  it('組出來的檔案有合法的 ZIP 檔頭簽章（PK）', () => {
    const zip = buildZip('a,b\r\n1,2', []);
    expect(zip[0]).toBe(0x50); // 'P'
    expect(zip[1]).toBe(0x4b); // 'K'
  });

  it('含照片時每張照片都真的被打進 ZIP（用檔名找得到）', () => {
    const photos = [{ itemId: 'r1', index: 0, src: TINY_PNG }];
    const zip = buildZip('csv content', photos);
    const text = new TextDecoder('latin1').decode(zip);
    expect(text).toContain('photos/r1-1.jpg');
    expect(text).toContain('receipts.csv');
  });

  it('estimateZipBytes 隨照片數量增加而變大', () => {
    const noPhotos = estimateZipBytes(100, []);
    const withPhotos = estimateZipBytes(100, [{ src: TINY_PNG }, { src: TINY_PNG }]);
    expect(withPhotos).toBeGreaterThan(noPhotos);
  });
});
