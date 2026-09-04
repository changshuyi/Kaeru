import { X } from 'lucide-react';
import { C } from '../../constants/theme.js';
import { yen } from '../../lib/money.js';
import { Badge } from '../ui/Badge.jsx';
import { BottomSheet } from '../ui/BottomSheet.jsx';

// 畫面 40：偵測到「這趟結束了」跳出的底部面板。條件很嚴（回程超過
// 24 小時、且這趟的收據全部退款或失效），只跳一次；三個出口都不會
// 自動建立或切換行程，一律等使用者自己按。
export function TripEndedSheet({
  t,
  trip,
  tripStats,
  refundedTax,
  daysSince,
  onClose,
  onCreateNew,
  onViewRecords,
}) {
  return (
    <BottomSheet onClose={onClose}>
      <div className="flex items-start justify-between gap-3">
        <h2
          className="font-bold"
          style={{ fontSize: '18px', lineHeight: 1.5, color: C.ink }}
        >
          {t.endedSheetTitle}
        </h2>
        <button onClick={onClose} style={{ color: C.sub }}>
          <X size={15} />
        </button>
      </div>

      <p className="mt-2" style={{ fontSize: '12.5px', lineHeight: 1.9, color: C.sub }}>
        {t.endedSheetDesc(trip.name || t.tripUnnamed, daysSince, tripStats.count)}
      </p>

      <div
        className="mt-3.5"
        style={{ borderTop: `1px solid ${C.line}`, paddingTop: '14px' }}
      >
        <div className="flex items-baseline justify-between">
          <span style={{ fontSize: '12.5px', color: C.sub }}>
            {t.endedSheetSettleLabel}
          </span>
          <span
            className="font-semibold tabular-nums"
            style={{ fontSize: '20px', color: C.blueDeep }}
          >
            ¥{yen(refundedTax)}
          </span>
        </div>
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {tripStats.refunded > 0 && (
            <Badge tone="sage">
              {tripStats.refunded}
              {t.statusRefunded}
            </Badge>
          )}
          {tripStats.dead > 0 && (
            <Badge tone="clay">
              {tripStats.dead}
              {t.statusDead}
            </Badge>
          )}
        </div>
      </div>

      <button
        onClick={onCreateNew}
        className="mt-5 w-full py-3.5 font-bold"
        style={{ backgroundColor: C.blue, color: '#FFFFFF', fontSize: '13.5px' }}
      >
        {t.endedSheetCta}
      </button>

      <div className="mt-4 flex items-center justify-center" style={{ gap: '22px' }}>
        <button onClick={onClose} style={{ fontSize: '12.5px', color: C.sub }}>
          {t.endedSheetNotNow}
        </button>
        <button
          onClick={onViewRecords}
          className="font-semibold"
          style={{ fontSize: '12.5px', color: C.blueDeep }}
        >
          {t.endedSheetViewRecords}
        </button>
      </div>

      <p
        className="mt-4"
        style={{
          borderTop: `1px solid ${C.line}`,
          paddingTop: '12px',
          fontSize: '11px',
          lineHeight: 1.75,
          color: C.sub,
        }}
      >
        {t.endedSheetFooterNote}
      </p>
    </BottomSheet>
  );
}
