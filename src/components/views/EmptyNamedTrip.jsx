import { C } from '../../constants/theme.js';
import { AIRPORTS } from '../../constants/airports.js';
import { useNowTick } from '../../hooks/useNowTick.js';
import { Badge } from '../ui/Badge.jsx';
import { CountdownDisplay } from './CountdownDisplay.jsx';

// 空狀態．畫面 39：行程已經有名字、有回程時間，但還沒有任何一張
// 收據。金額用 sub 色顯示（¥0 只是佔位，不是真的有消費），收據區塊
// 改成填色 CTA，底下留一個「先看一遍規則」去 FAQ 的連結。
export function EmptyNamedTrip({ t, trip, onAdd, onGoFaq, onGoSettings }) {
  useNowTick();
  const airport = trip && trip.airport ? AIRPORTS.find((a) => a.code === trip.airport) : null;
  // 已經有名字、有回程時間，只是還沒收據——倒數不會因為沒收據就算不
  // 出來，畫面 39 的截圖本來就顯示倒數，只是下面接的內容換成「行程
  // 已建立」徽章跟填色 CTA，不是查驗進度。
  const dep = trip && trip.departure ? new Date(trip.departure) : null;
  const diffMs = dep ? dep - new Date() : null;
  const dDays = diffMs !== null ? Math.floor(diffMs / 86400000) : null;
  const dHours =
    diffMs !== null ? Math.floor((diffMs % 86400000) / 3600000) : null;
  const departed = !!dep && diffMs <= 0;
  return (
    <div className="pb-6">
      <section className="pt-2">
        <CountdownDisplay
          t={t}
          dep={dep}
          diffMs={diffMs}
          dDays={dDays}
          dHours={dHours}
          departed={departed}
          onGoSettings={onGoSettings}
        />
        <div className="mt-4 flex flex-wrap gap-1.5">
          <Badge tone="sage" size="lg">
            {t.tripCreatedBadge}
          </Badge>
          {airport && (
            <span
              className="font-semibold"
              style={{
                fontSize: '10.5px',
                color: C.sub,
                border: `1px solid ${C.line}`,
                padding: '3px 7px',
              }}
            >
              {airport.name} {airport.code}
            </span>
          )}
        </div>
      </section>

      <section style={{ marginTop: '24px', borderTop: `1px solid ${C.ink}` }}>
        <div
          className="flex flex-col"
          style={{ gap: '15px', paddingTop: '18px' }}
        >
          <div className="flex items-baseline justify-between">
            <span style={{ fontSize: '12.5px', color: C.sub }}>
              {t.totalSpent}
            </span>
            <span
              className="font-semibold tabular-nums"
              style={{ fontSize: '24px', color: C.sub }}
            >
              ¥0
            </span>
          </div>
          <div
            className="flex items-end justify-between"
            style={{ borderTop: `1px solid ${C.line}`, paddingTop: '15px' }}
          >
            <span style={{ fontSize: '12.5px', color: C.sub }}>
              {t.estRefund}
            </span>
            <span
              className="font-semibold tabular-nums"
              style={{
                fontSize: '42px',
                color: C.sub,
                letterSpacing: '-0.01em',
                lineHeight: 1,
              }}
            >
              ¥0
            </span>
          </div>
        </div>
      </section>

      <section style={{ marginTop: '22px', padding: '20px', backgroundColor: C.soft }}>
        <p className="font-bold" style={{ fontSize: '15px', color: C.ink }}>
          {t.noReceiptsTitle}
        </p>
        <p className="mt-2" style={{ fontSize: '12.5px', lineHeight: 1.9, color: C.sub }}>
          {t.noReceiptsDesc}
        </p>
        <button
          onClick={onAdd}
          className="mt-4 w-full py-3 font-bold"
          style={{ backgroundColor: C.blue, color: '#FFFFFF', fontSize: '13px' }}
        >
          {t.addFirst}
        </button>
      </section>

      <button
        onClick={onGoFaq}
        className="flex w-full items-center justify-between"
        style={{ marginTop: '20px', borderTop: `1px solid ${C.line}`, paddingTop: '14px' }}
      >
        <span style={{ fontSize: '12.5px', color: C.ink }}>{t.rulesLinkLabel}</span>
        <span className="font-semibold" style={{ fontSize: '12.5px', color: C.blueDeep }}>
          {t.faqTitle} ›
        </span>
      </button>
    </div>
  );
}
