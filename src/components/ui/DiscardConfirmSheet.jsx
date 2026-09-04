import { C } from '../../constants/theme.js';
import { BottomSheet } from './BottomSheet.jsx';

// 「這筆還沒存，要放棄嗎？」的確認面板，三個表單共用一份文字跟樣式。
export function DiscardConfirmSheet({ t, onKeepEditing, onDiscard }) {
  return (
    <BottomSheet onClose={onKeepEditing}>
      <p className="font-bold" style={{ fontSize: '15px', color: C.ink }}>
        {t.discardTitle}
      </p>
      <div className="mt-4 flex gap-2">
        <button
          onClick={onKeepEditing}
          className="flex-1 py-3 text-sm font-semibold"
          style={{ border: `1px solid ${C.line}`, color: C.ink }}
        >
          {t.keepEditing}
        </button>
        <button
          onClick={onDiscard}
          className="flex-1 py-3 text-sm font-bold"
          style={{ backgroundColor: C.clay, color: '#FFFFFF' }}
        >
          {t.discard}
        </button>
      </div>
    </BottomSheet>
  );
}
