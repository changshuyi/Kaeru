import { CheckCircle2 } from 'lucide-react';
import { C } from '../../constants/theme.js';
import { yen } from '../../lib/money.js';
import { FullScreenSheet } from '../ui/FullScreenSheet.jsx';

// 退款確認：回程後 7 天問一次「錢進來了嗎」。不要求使用者每天回來記——
// 逐張勾選「已經進帳」的，「都收到了」關掉這個提示以後不會再跳；
// 「還沒收到」把下一次提醒時間往後推 7 天，不會每天煩使用者，但也
// 不會像「這趟結束了」那樣永遠只問一次。
// 勾選框直接對應收據的「已退款」狀態（verified ↔ refunded），不是另外
// 弄一個跟收據本身脫鉤的核取清單——這裡打勾，就是在說「這張真的退到
// 錢了」，跟收據詳情頁按「已退款」是同一件事，沒有理由分兩份資料。
export function RefundCheckSheet({
  t,
  trip,
  items,
  taxOf,
  onToggleStatus,
  onClose,
  onAllIn,
  onRemindLater,
  daysSince,
}) {
  const waiting = items
    .filter((it) => it.status !== 'refunded')
    .reduce((s, it) => s + taxOf(it), 0);
  return (
    <>
      <FullScreenSheet>
        <div
          className="sticky top-0 z-10 flex items-center justify-between kaeru-pad"
          style={{
            backgroundColor: C.page,
            borderBottom: `1px solid ${C.ink}`,
            paddingTop: 'max(16px, env(safe-area-inset-top))',
            paddingBottom: '16px',
          }}
        >
          <button onClick={onClose} style={{ fontSize: '13px', color: C.blueDeep }}>
            ‹ {t.back}
          </button>
          <h2 className="font-bold" style={{ fontSize: '15px' }}>
            {t.refundCheckTitle}
          </h2>
          <button
            onClick={onClose}
            className="font-bold"
            style={{ fontSize: '13px', color: C.blueDeep }}
          >
            {t.checkDone}
          </button>
        </div>

        <div className="kaeru-pad py-6">
          <p style={{ color: C.sub, fontSize: '11px', letterSpacing: '0.1em' }}>
            {t.refundCheckSubtitle(trip.name || t.tripUnnamed, daysSince)}
          </p>
          <p className="mt-2" style={{ fontSize: '14px', lineHeight: 1.95 }}>
            {t.refundCheckDesc(items.length)}
          </p>

          <div
            className="mt-4 flex items-baseline justify-between"
            style={{ borderTop: `1px solid ${C.ink}`, paddingTop: '14px' }}
          >
            <span style={{ fontSize: '12.5px', color: C.sub }}>
              {t.refundCheckWaiting}
            </span>
            <span
              className="font-semibold tabular-nums"
              style={{ fontSize: '26px', color: C.blueDeep }}
            >
              ¥{yen(waiting)}
            </span>
          </div>

          <div className="mt-2">
            {items.map((it, i) => {
              const checked = it.status === 'refunded';
              return (
                <button
                  key={it.id}
                  onClick={() => onToggleStatus(it.id, checked)}
                  className="flex w-full items-center justify-between gap-3 py-3.5 text-left"
                  style={{ borderTop: `1px solid ${i === 0 ? C.ink : C.line}` }}
                >
                  <span className="min-w-0">
                    <span className="block truncate font-bold" style={{ fontSize: '14.5px' }}>
                      {it.shop}
                    </span>
                    <span
                      className="mt-0.5 block tabular-nums"
                      style={{ color: C.sub, fontSize: '11px' }}
                    >
                      {it.date} · {t.taxAmount} ¥{yen(taxOf(it))}
                    </span>
                  </span>
                  <span
                    className="flex shrink-0 items-center justify-center"
                    style={{
                      width: '22px',
                      height: '22px',
                      backgroundColor: checked ? C.sage : 'transparent',
                      border: checked ? 'none' : `1px solid ${C.line}`,
                    }}
                  >
                    {checked && (
                      <CheckCircle2 size={14} style={{ color: '#FFFFFF' }} />
                    )}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="mt-4" style={{ backgroundColor: C.soft, padding: '14px' }}>
            <p style={{ color: C.sub, fontSize: '11.5px', lineHeight: 1.8 }}>
              {t.refundCheckInfo}
            </p>
          </div>

          <div className="mt-5 flex gap-2">
            <button
              onClick={onRemindLater}
              className="flex-1 py-3 text-sm"
              style={{ border: `1px solid ${C.line}`, color: C.sub }}
            >
              {t.refundCheckNotYet}
            </button>
            <button
              onClick={onAllIn}
              className="py-3 text-sm font-bold"
              style={{ flex: 1.4, backgroundColor: C.blue, color: '#FFFFFF' }}
            >
              {t.refundCheckAllIn}
            </button>
          </div>

          <button
            onClick={onRemindLater}
            className="mt-3 w-full text-center"
            style={{ fontSize: '11px', color: C.sub }}
          >
            {t.refundCheckRemindLater}
          </button>
        </div>
      </FullScreenSheet>
    </>
  );
}
