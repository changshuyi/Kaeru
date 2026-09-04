import { C } from '../../constants/theme.js';
import { AIRPORTS, DEFAULT_ARRIVE_HOURS, arriveHoursText } from '../../constants/airports.js';
import { yen, twd } from '../../lib/money.js';
import { useNowTick } from '../../hooks/useNowTick.js';
import { Badge } from '../ui/Badge.jsx';
import { Row } from '../ui/Row.jsx';
import { CountdownDisplay } from './CountdownDisplay.jsx';
import { EmptyUnnamedTrip } from './EmptyUnnamedTrip.jsx';
import { EmptyNamedTrip } from './EmptyNamedTrip.jsx';

export function HomeView({
  t,
  stats,
  settings,
  trip,
  hasItems,
  itemCount,
  onAdd,
  onGoSettings,
  onGoList,
  onGoCheck,
  onEditTrip,
  onGoFaq,
  onStartSim,
}) {
  useNowTick();
  const dep = trip && trip.departure ? new Date(trip.departure) : null;
  const diffMs = dep ? dep - new Date() : null;
  const dDays = diffMs !== null ? Math.floor(diffMs / 86400000) : null;
  const dHours =
    diffMs !== null ? Math.floor((diffMs % 86400000) / 3600000) : null;
  const airport = trip && trip.airport ? AIRPORTS.find((a) => a.code === trip.airport) : null;
  const arriveBuffer = airport ? airport.hours : DEFAULT_ARRIVE_HOURS;
  const arriveBy = dep ? new Date(dep.getTime() - arriveBuffer * 3600000) : null;
  const fmt = (d) =>
    d
      ? `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
      : '';
  const departed = !!dep && diffMs <= 0;
  // 回程當天行動列：只在起飛前 24 小時內出現，其他時候完全不存在——
  // 不要用 disabled 或灰掉的版本佔位，沒到那個時間點就當它不存在。
  const within24h = !!dep && diffMs !== null && diffMs > 0 && diffMs <= 24 * 3600 * 1000;

  // 還沒有任何一張收據：先讓「行程」這個概念被看見，而不是悄悄疊在
  // 匿名行程裡。有沒有名字／回程時間決定看到畫面 38 還是畫面 39。
  if (!hasItems) {
    const unnamed = !trip || !trip.name || !trip.departure;
    return unnamed ? (
      <EmptyUnnamedTrip
        t={t}
        trip={trip}
        onEditTrip={onEditTrip}
        onAdd={onAdd}
        onStartSim={onStartSim}
      />
    ) : (
      <EmptyNamedTrip
        t={t}
        trip={trip}
        onAdd={onAdd}
        onGoFaq={onGoFaq}
        onGoSettings={onGoSettings}
      />
    );
  }

  return (
    <div className="space-y-10 pb-6">
      <section className="pt-2">
        {dep ? (
          <CountdownDisplay
            t={t}
            dep={dep}
            diffMs={diffMs}
            dDays={dDays}
            dHours={dHours}
            departed={departed}
            onGoSettings={onGoSettings}
          />
        ) : (
          // 缺口，不是隱藏——藏起來就沒人知道少了什麼。原本 52px 倒數
          // 的位置換成這塊虛線缺口，段標位置跟正常倒數對得起來，讓使用
          // 者一看就知道「這裡本來該有東西」。見
          // CLAUDE_CODE_DELTA_未設定回程時間.md 第 1 節。
          <div style={{ border: `1px dashed ${C.clay}`, padding: '16px' }}>
            <p style={{ color: C.sub, fontSize: '10.5px', letterSpacing: '0.24em' }}>
              {t.departIn}
            </p>
            <p className="mt-2 font-bold" style={{ fontSize: '19px', color: C.ink }}>
              {t.noDepartureTitle}
            </p>
            <p className="mt-2" style={{ fontSize: '13px', color: C.sub, lineHeight: 1.75 }}>
              {t.noDepartureDesc}
            </p>
            <div className="mt-4 flex gap-1.5">
              <button
                onClick={onEditTrip}
                className="font-semibold"
                style={{ flex: 1, padding: '12px 0', backgroundColor: C.blue, color: '#FFFFFF' }}
              >
                {t.setDepartureCta}
              </button>
              {/* 「晚點」故意不接任何動作——這塊缺口是持續存在的提示，
                  不是一次性的 toast，不需要「關閉」或「稍後提醒」這種
                  狀態；點了就是單純承認「現在不想填」，畫面維持原樣，
                  缺口會一直留到使用者自己填了回程時間才消失。 */}
              <button
                className="font-semibold"
                style={{ padding: '12px 18px', border: `1px solid ${C.line}`, color: C.ink }}
              >
                {t.laterCta}
              </button>
            </div>
          </div>
        )}
        {dep && diffMs > 0 && !within24h && (
          <div className="mt-4 flex flex-wrap gap-1.5">
            <Badge tone="blue">
              {t.arriveTagPre}
              {fmt(arriveBy)}
              {t.arriveTagSuf}
            </Badge>
            <Badge tone="clay">{t.checkinBadge}</Badge>
          </div>
        )}

        {within24h && (
          <button
            onClick={onGoCheck}
            className="mt-4 flex w-full items-center justify-between gap-3 text-left"
            style={{
              backgroundColor: stats.todoCount > 0 ? C.blue : C.sage,
              padding: '15px 16px',
            }}
          >
            <div className="min-w-0">
              <p
                className="font-bold"
                style={{ fontSize: '10px', letterSpacing: '0.2em', color: C.blueSoft }}
              >
                {t.todayActionTitle}
              </p>
              <p
                className="mt-1 truncate font-bold"
                style={{ fontSize: '15px', color: '#FFFFFF' }}
              >
                {stats.todoCount > 0
                  ? t.todayActionLine(stats.todoCount)
                  : t.todayActionDone}
              </p>
              {stats.todoCount > 0 && (
                <p
                  className="mt-0.5 tabular-nums"
                  style={{ fontSize: '11.5px', color: C.blueSoft }}
                >
                  ¥{yen(stats.todoTax)}
                </p>
              )}
            </div>
            {stats.todoCount > 0 && (
              <span
                className="shrink-0 font-bold"
                style={{ fontSize: '12.5px', color: '#FFFFFF' }}
              >
                {t.goCheck} ›
              </span>
            )}
          </button>
        )}

        {stats.deadlineSoon && (
          <div
            className="mt-3"
            style={{ backgroundColor: C.clay, padding: '15px 16px' }}
          >
            <p className="font-bold" style={{ fontSize: '13px', color: '#FFFFFF' }}>
              {t.deadlineBannerTitle(stats.deadlineSoon.count, stats.deadlineSoon.days)}
            </p>
            <p className="mt-1" style={{ fontSize: '11.5px', color: '#F3E7DD' }}>
              {t.deadlineBannerDetail(
                yen(stats.deadlineSoon.amount),
                stats.deadlineSoon.shop || t.pendingShopPlaceholder,
              )}
            </p>
          </div>
        )}
      </section>

      {dep ? (
        <section
          style={{
            borderTop: `1px solid ${C.ink}`,
            borderBottom: `1px solid ${C.ink}`,
          }}
        >
          <Row label={t.totalSpent} align="baseline">
            <span
              className="font-semibold tabular-nums"
              style={{ color: C.ink, fontSize: '24px' }}
            >
              ¥{yen(stats.totalIncl)}
            </span>
          </Row>

          <Row
            label={departed ? t.refundedTotalLabel : t.estRefund}
            sub={`≈ NT$${twd((departed ? stats.refundedTax : stats.refundable) * settings.rate)}`}
            align="end"
          >
            <span
              className="kaeru-refund font-semibold tabular-nums"
              style={{ color: C.blueDeep, lineHeight: 1 }}
            >
              ¥{yen(departed ? stats.refundedTax : stats.refundable)}
            </span>
          </Row>

          <Row label={t.pending}>
            {stats.pendingCount > 0 && (
              <Badge tone="blue" size="lg">
                {t.tripNow}
              </Badge>
            )}
            <span className="tabular-nums">
              <span
                className="font-semibold"
                style={{ color: C.ink, fontSize: '24px' }}
              >
                {stats.pendingCount}
              </span>
              <span className="ml-1 text-xs" style={{ color: C.sub }}>
                {t.itemsUnit}
              </span>
            </span>
          </Row>

          <Row label={t.nearestDeadline} last>
            {stats.minDays === null ? (
              <span className="text-sm" style={{ color: C.sub }}>
                {t.noDeadline}
              </span>
            ) : (
              <>
                <Badge tone={stats.minDays <= 14 ? 'clay' : 'outline'} size="lg">
                  {t.dueLeft} {stats.minDays} {t.days}
                </Badge>
                <span className="tabular-nums">
                  <span
                    className="font-semibold"
                    style={{ color: C.ink, fontSize: '24px' }}
                  >
                    {stats.minDays}
                  </span>
                  <span className="ml-1 text-xs" style={{ color: C.sub }}>
                    {t.days}
                  </span>
                </span>
              </>
            )}
          </Row>
        </section>
      ) : (
        // 沒有回程時間時只留三行——「還沒處理」「最近到期」這兩個概念
        // 都得靠回程時間才有意義，硬要顯示只會逼自己面對一堆「還沒有
        // 期限」，不如乾脆換成更誠實的摘要，剩下的疑問留給下面「還算
        // 不出來的事」統一講。已存的收據還是要看得到金額，不能因為
        // 回程時間沒填就連這個都藏起來。
        <section
          style={{
            borderTop: `1px solid ${C.ink}`,
            borderBottom: `1px solid ${C.ink}`,
          }}
        >
          <Row label={t.totalSpent} align="baseline">
            <span
              className="font-semibold tabular-nums"
              style={{ color: C.ink, fontSize: '24px' }}
            >
              ¥{yen(stats.totalIncl)}
            </span>
          </Row>
          <Row
            label={t.estRefund}
            sub={`≈ NT$${twd(stats.refundable * settings.rate)}`}
            align="end"
          >
            <span
              className="kaeru-refund font-semibold tabular-nums"
              style={{ color: C.blueDeep, lineHeight: 1 }}
            >
              ¥{yen(stats.refundable)}
            </span>
          </Row>
          <Row label={t.savedCountLabel(itemCount)} last>
            <button onClick={onGoList} className="font-bold" style={{ fontSize: '13px', color: C.blueDeep }}>
              {t.viewListCta} ›
            </button>
          </Row>
        </section>
      )}

      {!dep && (
        <section>
          <h3
            className="font-bold"
            style={{ color: C.blue, fontSize: '10.5px', letterSpacing: '0.24em' }}
          >
            {t.cantCalcYetLabel}
          </h3>
          <div className="mt-4" style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            {[
              [t.cantCalcDeadlinePerReceipt, t.deadlinePendingBadge],
              [t.cantCalcDepartDayFlow, t.notSetBadge],
              [t.cantCalcAirportQueue, t.notSetBadge],
            ].map(([label, badge], n) => (
              <div key={n} className="flex items-center justify-between gap-3">
                <span style={{ fontSize: '13.5px', color: C.ink }}>{label}</span>
                <Badge tone="outline">{badge}</Badge>
              </div>
            ))}
          </div>
          <p
            className="mt-4"
            style={{ backgroundColor: C.soft, padding: '14px', fontSize: '11.5px', color: C.sub, lineHeight: 1.8 }}
          >
            {t.cantCalcNote}
          </p>
        </section>
      )}

      {dep && !departed && (
        <section>
          <h3
            className="font-bold"
            style={{ color: C.blue, fontSize: '10.5px', letterSpacing: '0.24em' }}
          >
            {t.departChecklist}
          </h3>
          <ol
            className="mt-4"
            style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}
          >
            {[t.step1(arriveHoursText(t, arriveBuffer)), t.step2, t.step3, t.step4].map((x, n) => (
              <li key={n} className="flex" style={{ gap: '14px' }}>
                <span
                  className="shrink-0 font-bold tabular-nums"
                  style={{ color: C.blue, fontSize: '11px' }}
                >
                  {String(n + 1).padStart(2, '0')}
                </span>
                <span style={{ fontSize: '13px', lineHeight: 1.75 }}>{x}</span>
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}
