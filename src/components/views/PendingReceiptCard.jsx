import { C } from '../../constants/theme.js';
import { yen, netOfItem } from '../../lib/money.js';
import { Badge } from '../ui/Badge.jsx';

// 資料待補的收據卡——虛線框代表「資料還沒補齊」，跟空狀態的待填容器
// 同一個語意。待補現在有兩種各自獨立的原因：店名沒讀到、金額沒讀到
// （見 isPendingInfo），兩種可能同時發生，也可能只有其中一種——這張
// 卡要照實際缺什麼顯示，不能兩種都套同一句「店名待補」文案：店名讀到
// 了就要顯示真正的店名，金額讀到了就要顯示真正的金額，不能因為另一項
// 缺著，就連已經讀到的這項也用假資料蓋過去（那就是「¥0」那個 bug的
// 同一種錯法）。點進去都是開完整表單，補齊缺的部分。
export function PendingReceiptCard({ it, t, taxOf, onClick }) {
  const tax = taxOf(it);
  const fmtShort = (iso) => {
    const dt = new Date(iso + 'T00:00:00');
    return `${dt.getMonth() + 1}/${dt.getDate()}`;
  };
  const shopKnown = !!(it.shop && it.shop.trim());
  const amountKnown = !!it.incl;
  const fillLink = !shopKnown && !amountKnown
    ? t.pendingFillAllLink
    : !shopKnown
      ? t.pendingFillLink
      : t.pendingFillAmountLink;
  return (
    <section>
      <div className="flex items-end justify-between gap-3 pb-2">
        <div className="min-w-0">
          <h3
            className="truncate font-bold"
            style={{ fontSize: '13.5px', color: shopKnown ? C.ink : C.sub }}
          >
            {shopKnown ? it.shop : t.pendingShopPlaceholder}
          </h3>
          <p style={{ color: C.sub, fontSize: '11px' }}>
            {t.pendingCapturedOn(fmtShort(it.date))}
          </p>
        </div>
        <Badge tone="outline">
          {!shopKnown ? t.pendingBadge : t.pendingAmountBadge}
        </Badge>
      </div>
      <button
        onClick={onClick}
        className="block w-full px-3.5 py-3.5 text-left"
        style={{ border: `1px dashed ${C.line}` }}
      >
        <div className="flex items-baseline justify-between gap-3">
          {amountKnown ? (
            <p
              className="font-semibold tabular-nums"
              style={{ fontSize: '18px', color: C.ink }}
            >
              ¥{yen(it.incl)}
            </p>
          ) : (
            <p className="font-semibold" style={{ fontSize: '15px', color: C.sub }}>
              {t.pendingAmountPlaceholder}
            </p>
          )}
          {amountKnown && (
            <p className="tabular-nums" style={{ color: C.sub, fontSize: '11px' }}>
              {t.taxAmount} ¥{yen(tax)}
            </p>
          )}
        </div>
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {amountKnown ? (
            netOfItem(it) >= 5000 ? (
              <Badge tone="sage">{t.reached}</Badge>
            ) : (
              <Badge tone="clay">
                {t.short} ¥{yen(5000 - netOfItem(it))}
              </Badge>
            )
          ) : (
            <Badge tone="outline">{t.pendingAmountBadge}</Badge>
          )}
          {it.refundMethod === 'registered' && (
            <Badge tone="outline">{t.refundReg}</Badge>
          )}
        </div>
        <p
          className="mt-2.5 font-semibold"
          style={{ color: C.blueDeep, fontSize: '12px' }}
        >
          {fillLink} ›
        </p>
      </button>
    </section>
  );
}
