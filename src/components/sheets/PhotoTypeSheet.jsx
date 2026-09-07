import { X, CheckCircle2 } from 'lucide-react';
import { C } from '../../constants/theme.js';
import { BottomSheet } from '../ui/BottomSheet.jsx';

// 一張照片是「收據照片」（憑證，跑過 OCR、是金額來源）還是「物品照片」
// （純備忘，不跑辨識、不影響金額）——長按縮圖跳出來的小選單，兩者互斥、
// 選了就換，跟 BottomSheet 裡其他「選單式」動作用同一套視覺語言。
export function PhotoTypeSheet({ t, current, onPick, onClose }) {
  return (
    <BottomSheet onClose={onClose}>
      <div className="flex items-center justify-between">
        <h2 className="font-bold" style={{ fontSize: '18px' }}>
          {t.photoTypeSheetTitle}
        </h2>
        <button onClick={onClose} style={{ color: C.sub }}>
          <X size={18} />
        </button>
      </div>
      <div className="mt-3">
        {[
          { v: 'receipt', label: t.photoTypeReceiptLabel, hint: t.photoTypeReceiptHint },
          { v: 'item', label: t.photoTypeItemLabel, hint: t.photoTypeItemHint },
        ].map((opt, i) => (
          <button
            key={opt.v}
            onClick={() => onPick(opt.v)}
            className="flex w-full items-center justify-between py-4 text-left"
            style={{ borderTop: `1px solid ${i === 0 ? C.ink : C.line}` }}
          >
            <span>
              <span
                className="block font-bold"
                style={{ fontSize: '15px', color: current === opt.v ? C.blueDeep : C.ink }}
              >
                {opt.label}
              </span>
              <span className="block" style={{ fontSize: '11.5px', color: C.sub }}>
                {opt.hint}
              </span>
            </span>
            {current === opt.v && <CheckCircle2 size={16} style={{ color: C.blueDeep, flexShrink: 0 }} />}
          </button>
        ))}
      </div>
    </BottomSheet>
  );
}
