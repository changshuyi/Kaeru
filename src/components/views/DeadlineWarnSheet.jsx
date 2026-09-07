import { X } from 'lucide-react';
import { C } from '../../constants/theme.js';
import { yen } from '../../lib/money.js';
import { BottomSheet } from '../ui/BottomSheet.jsx';

// ≤3 天期限警示：一次性站內提示（這個 app 沒有裝真的推播套件，用「打開
// App 時符合條件就跳一次」代替，跟「這趟結束了」同一種機制）。
export function DeadlineWarnSheet({ t, deadlineSoon, onClose, onGoCheck }) {
  return (
    <BottomSheet onClose={onClose}>
      <div className="flex items-start justify-between gap-3">
        <h2
          className="font-bold"
          style={{ fontSize: '18px', lineHeight: 1.5, color: C.ink }}
        >
          {t.deadlineBannerTitle(deadlineSoon.count, deadlineSoon.days)}
        </h2>
        <button onClick={onClose} style={{ color: C.sub }}>
          <X size={15} />
        </button>
      </div>
      <p className="mt-2" style={{ fontSize: '12.5px', lineHeight: 1.9, color: C.clayInk }}>
        {t.deadlineBannerDetail(
          yen(deadlineSoon.amount),
          deadlineSoon.shop || t.pendingShopPlaceholder,
        )}
      </p>
      <button
        onClick={onGoCheck}
        className="mt-5 w-full py-3.5 font-bold"
        style={{ backgroundColor: C.blue, color: '#FFFFFF', fontSize: '13.5px' }}
      >
        {t.goCheck}
      </button>
    </BottomSheet>
  );
}
