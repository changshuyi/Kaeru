import { C } from '../../constants/theme.js';
import { formatBytes } from '../../exportData.js';
import { BottomSheet } from '../ui/BottomSheet.jsx';

// 只刪照片——一般 sheet 就好，這個動作留得住金額紀錄，破壞性比另外
// 兩種刪除小得多，不需要置中對話框那種「先停下來讀完」的重量級處理。
export function DeletePhotosOnlySheet({ t, photoBytes, onClose, onConfirm }) {
  return (
    <BottomSheet onClose={onClose}>
      <p className="font-bold" style={{ fontSize: '15px', color: C.ink }}>
        {t.deletePhotosOnlyTitle}
      </p>
      <p className="mt-2" style={{ fontSize: '13px', color: C.sub, lineHeight: 1.8 }}>
        {t.deletePhotosOnlyDesc(formatBytes(photoBytes))}
      </p>
      <div className="mt-4 flex gap-2">
        <button
          onClick={onClose}
          className="flex-1 py-3 text-sm font-semibold"
          style={{ border: `1px solid ${C.line}`, color: C.ink }}
        >
          {t.cancel}
        </button>
        <button
          onClick={onConfirm}
          className="flex-1 py-3 text-sm font-bold"
          style={{ backgroundColor: C.clay, color: '#FFFFFF' }}
        >
          {t.deletePhotosOnlyCta}
        </button>
      </div>
    </BottomSheet>
  );
}
