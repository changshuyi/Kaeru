import { useState } from 'react';
import { C } from '../../constants/theme.js';
import { yen } from '../../lib/money.js';
import { daysLeft, isPendingInfo, isExpiredUnclaimed } from '../../lib/date.js';
import { Badge } from '../ui/Badge.jsx';
import { PendingReceiptCard } from './PendingReceiptCard.jsx';
import { ReceiptCard } from './ReceiptCard.jsx';

export function ListView({
  t,
  items,
  groups,
  taxOf,
  settings,
  itemPhotoCounts,
  hasDeparture,
  onEditTrip,
  onOpen,
  onAdd,
}) {
  const [filter, setFilter] = useState('all');

  if (!items.length) {
    return (
      <div
        className="rounded-2xl p-6 text-center"
        style={{ backgroundColor: C.card, border: `1px dashed ${C.line}` }}
      >
        <p className="text-sm" style={{ color: C.sub }}>
          {t.emptyList}
        </p>
        <button
          onClick={onAdd}
          className="mt-3 rounded-lg px-4 py-2 text-sm font-medium"
          style={{ backgroundColor: C.blue, color: '#FFFFFF' }}
        >
          {t.addReceipt}
        </button>
      </div>
    );
  }

  // 資料待補（快速新增、店名還沒補上）的收據不進一般的「同店同日」分組——
  // 店名是空的，硬分組只會把不相干的待補收據濫在一起。這裡拆出來，
  // 每一張獨立顯示，「待補」篩選只看得到它們，「全部」則排在最前面。
  const pendingItems = items
    .filter(isPendingInfo)
    .sort((a, b) => b.date.localeCompare(a.date));

  const match = (it) => {
    if (filter === 'all') return true;
    if (filter === 'done') return it.status === 'refunded';
    if (filter === 'todo') return it.status !== 'refunded' && !it.consumed;
    return true;
  };

  const showPendingSection =
    (filter === 'all' || filter === 'pending') && pendingItems.length > 0;
  const showGroupedSection = filter !== 'pending';

  const keys = showGroupedSection
    ? Array.from(groups.keys())
        .filter((k) => !groups.get(k).arr.every(isPendingInfo))
        .filter((k) =>
          groups.get(k).arr.some((it) => !isPendingInfo(it) && match(it)),
        )
        // 排序直接讀該組第一筆收據的 date，不要切 key 字串——key 是
        // `店名||日期` 手動拼出來的，店名要是剛好包含 "||" 這個子字串
        // （不無可能，店名是使用者自己輸入的自由文字），split 出來的
        // 段數會跑掉，日期就不會是預期的那一段。
        .sort((a, b) =>
          groups.get(b).arr[0].date.localeCompare(groups.get(a).arr[0].date),
        )
    : [];

  const nothingToShow =
    filter === 'pending' ? !pendingItems.length : !keys.length && !showPendingSection;

  // 沒有回程時間時，這些收據的卡片上都會掛「期限待定」——這裡數一次
  // 有幾張，跟每張卡片自己的 showDeadlinePending 判斷用同一套條件
  // （沒待補、沒消費掉、沒真的過期），才不會兩邊算出不同的數字。
  const deadlinePendingCount = hasDeparture
    ? 0
    : items.filter(
        (it) => !isPendingInfo(it) && !it.consumed && !isExpiredUnclaimed(it),
      ).length;

  return (
    <div className="space-y-4">
      <div
        className="flex"
        style={{ gap: '16px', borderBottom: `1px solid ${C.line}` }}
      >
        {['all', 'pending', 'todo', 'done'].map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className="shrink-0 pb-2.5"
            style={{
              fontSize: '12.5px',
              fontWeight: filter === f ? 700 : 500,
              color: filter === f ? C.ink : C.sub,
              borderBottom:
                filter === f ? `2px solid ${C.ink}` : '2px solid transparent',
              marginBottom: '-1px',
            }}
          >
            {t.filters[f]}
          </button>
        ))}
      </div>

      {deadlinePendingCount > 0 && (
        <button
          onClick={onEditTrip}
          className="flex w-full items-center justify-between gap-3 text-left"
          style={{ border: `1px dashed ${C.clay}`, padding: '14px 16px' }}
        >
          <div className="min-w-0">
            <p style={{ fontSize: '13.5px', fontWeight: 700, color: C.ink }}>
              {t.deadlinePendingBanner(deadlinePendingCount)}
            </p>
            <p className="mt-1" style={{ fontSize: '11.5px', color: C.sub }}>
              {t.deadlinePendingBannerDesc}
            </p>
          </div>
          <span className="shrink-0 font-bold" style={{ fontSize: '12.5px', color: C.blueDeep }}>
            {t.deadlinePendingSetCta} ›
          </span>
        </button>
      )}

      {showPendingSection && (
        <div style={{ backgroundColor: C.soft, padding: '14px 16px' }}>
          <p style={{ fontSize: '13px', fontWeight: 700, color: C.ink }}>
            {t.filterPendingBanner(pendingItems.length)}
          </p>
          <p
            className="mt-1"
            style={{ fontSize: '11.5px', color: C.sub, lineHeight: 1.7 }}
          >
            {t.filterPendingBannerDesc}
          </p>
        </div>
      )}

      {nothingToShow && (
        <p
          className="rounded-xl p-6 text-center text-sm"
          style={{
            backgroundColor: C.card,
            color: C.sub,
            border: `1px dashed ${C.line}`,
          }}
        >
          {t.noMatch}
        </p>
      )}

      {showPendingSection && (
        <div className="kaeru-group-gap">
          {pendingItems.map((it) => (
            <PendingReceiptCard
              key={it.id}
              it={it}
              t={t}
              taxOf={taxOf}
              onClick={() => onOpen(it.id)}
            />
          ))}
        </div>
      )}

      {showGroupedSection && (
        <div className="kaeru-group-gap">
          {keys.map((k) => {
            const g = groups.get(k);
            // 直接讀這組收據本身的 shop/date，不要切 key 字串——理由跟
            // 上面排序那段一樣，店名裡萬一有 "||" 會讓 split 錯位。
            const { shop, date } = g.arr[0];
            // 同一組所有收據共用同一個日期——過期不過期整組會一起翻，直接
            // 拿這個日期算一次就好。跟每張卡片自己的 expiredDead 判斷
            // 要一致：已在境內消費、已查驗、已退款都不算「錯過」，只有
            // 還卡在購買/登記階段、又超過 90 天的才算，不然表頭顯示
            // 「已過期」但裡面的卡片（例如已經退款的那張）卻正常顯示，
            // 兩邊會自相矛盾。
            const groupDays = daysLeft(date);
            const groupExpired =
              groupDays !== null &&
              groupDays < 0 &&
              g.arr.some(
                (it) =>
                  !it.consumed &&
                  it.status !== 'refunded' &&
                  it.status !== 'verified',
              );
            return (
              <section key={k}>
                <div
                  className="flex items-end justify-between gap-3 pb-2"
                  style={{
                    borderBottom: `1px solid ${g.ok && !groupExpired ? C.ink : C.clay}`,
                  }}
                >
                  <div className="min-w-0">
                    <h3
                      className="truncate font-bold"
                      style={{ fontSize: '13.5px' }}
                    >
                      {shop || '—'}
                    </h3>
                    <p
                      className="tabular-nums"
                      style={{ color: C.sub, fontSize: '11px' }}
                    >
                      {date} · {g.arr.length} {t.itemsUnit}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p
                      className="tabular-nums"
                      style={{ color: C.sub, fontSize: '11px' }}
                    >
                      {t.netTotal} ¥{yen(g.net)}
                    </p>
                    <span className="mt-1 inline-block">
                      {groupExpired ? (
                        <Badge tone="clay">{t.expiredBadge}</Badge>
                      ) : g.ok ? (
                        <Badge tone="sage">{t.reached}</Badge>
                      ) : (
                        <Badge tone="clay">
                          {t.short} ¥{yen(5000 - g.net)}
                        </Badge>
                      )}
                    </span>
                  </div>
                </div>
                <div style={{ border: `1px solid ${C.line}` }}>
                  {g.arr
                    .filter((it) => !isPendingInfo(it) && match(it))
                    .map((it, i) => (
                      <ReceiptCard
                        key={it.id}
                        it={it}
                        t={t}
                        taxOf={taxOf}
                        settings={settings}
                        groupOk={g.ok}
                        separator={i > 0}
                        itemPhotoCount={itemPhotoCounts[it.id] || 0}
                        hasDeparture={hasDeparture}
                        onEditTrip={onEditTrip}
                        onClick={() => onOpen(it.id)}
                      />
                    ))}
                </div>
              </section>
            );
          })}
        </div>
      )}

      {deadlinePendingCount > 0 && (
        <div style={{ borderTop: `1px solid ${C.ink}`, paddingTop: '20px' }}>
          <h3
            className="font-bold"
            style={{ color: C.blue, fontSize: '10.5px', letterSpacing: '0.24em' }}
          >
            {t.deadlinePendingWhatLabel}
          </h3>
          <ol className="mt-4" style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            {[
              t.deadlinePendingTip1,
              t.deadlinePendingTip2,
              t.deadlinePendingTip3,
            ].map((tip, n) => (
              <li key={n} className="flex" style={{ gap: '14px' }}>
                <span
                  className="shrink-0 font-bold tabular-nums"
                  style={{ color: C.blue, fontSize: '11px' }}
                >
                  {String(n + 1).padStart(2, '0')}
                </span>
                <span style={{ fontSize: '13px', lineHeight: 1.75 }}>{tip}</span>
              </li>
            ))}
          </ol>
          <p
            className="mt-4"
            style={{ backgroundColor: C.soft, padding: '14px', fontSize: '11.5px', color: C.sub, lineHeight: 1.8 }}
          >
            {t.deadlinePendingNote}
          </p>
        </div>
      )}
    </div>
  );
}
