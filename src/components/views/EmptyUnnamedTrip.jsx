import { ChevronRight } from 'lucide-react';
import { C } from '../../constants/theme.js';

// 空狀態．畫面 38：行程還沒命名（沒名字或沒回程時間），而且一張收據
// 都還沒加。用一張待填卡把「行程」這個概念亮出來，主 CTA 去把名字和
// 回程時間填上；逃生口讓使用者可以先加收據，晚點再回來補。
export function EmptyUnnamedTrip({ t, trip, onEditTrip, onAdd, onStartSim }) {
  // 兩行狀態要照實際資料顯示，不能兩個都寫死「未填」——名字跟回程
  // 時間可能只缺一個（例如新增第二趟行程會帶入上次的回程時間，但
  // 名字是空的；反過來使用者也可能先取好名字才回頭填回程時間）。
  // 猜錯/騙人比留白更危險，見「擋住不如誠實」原則。
  const missingName = !trip || !trip.name;
  const missingDeparture = !trip || !trip.departure;
  const depDate = trip && trip.departure ? new Date(trip.departure) : null;
  const depLabel = depDate
    ? `${depDate.getMonth() + 1}/${depDate.getDate()} ${String(depDate.getHours()).padStart(2, '0')}:${String(depDate.getMinutes()).padStart(2, '0')}`
    : t.unfilled;
  // 名字本身不重要，回程時間才是地基——只缺回程時間時，標題／CTA
  // 改講回程時間，不要繼續講「還沒有名字」（那時名字已經填了）。
  const title = missingDeparture ? t.noDepartureTitle : t.emptyUnnamedTitle;
  const cta = missingDeparture ? t.setDepartureCta : t.emptyUnnamedCta;
  return (
    <div className="pb-6">
      <section className="pt-2">
        <div style={{ border: `1px dashed ${C.line}`, padding: '22px 20px' }}>
          <p style={{ fontSize: '10.5px', letterSpacing: '0.24em', color: C.sub }}>
            {t.emptyUnnamedKicker}
          </p>
          <p
            className="mt-2 font-bold"
            style={{ fontSize: '26px', color: C.sub, lineHeight: 1.2 }}
          >
            {title}
          </p>
          <div
            className="mt-3 flex flex-col"
            style={{
              gap: '8px',
              borderTop: `1px dashed ${C.line}`,
              paddingTop: '12px',
            }}
          >
            <div className="flex items-center justify-between">
              <span style={{ fontSize: '12.5px', color: C.sub }}>
                {t.tripName}
              </span>
              <span
                className="font-semibold"
                style={{ fontSize: '12.5px', color: missingName ? C.clayInk : C.ink }}
              >
                {missingName ? t.unfilled : trip.name}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span style={{ fontSize: '12.5px', color: C.sub }}>
                {t.departure}
              </span>
              <span
                className="font-semibold"
                style={{ fontSize: '12.5px', color: missingDeparture ? C.clayInk : C.ink }}
              >
                {depLabel}
              </span>
            </div>
          </div>
        </div>

        <p
          className="mt-5"
          style={{ fontSize: '13px', lineHeight: 1.95, color: C.ink }}
        >
          {t.emptyUnnamedDesc}
        </p>

        <button
          onClick={onEditTrip}
          className="mt-4 w-full py-3.5 font-bold"
          style={{ backgroundColor: C.blue, color: '#FFFFFF', fontSize: '14px' }}
        >
          {cta}
        </button>

        <p className="mt-3 text-center" style={{ fontSize: '12.5px' }}>
          <span style={{ color: C.sub }}>{t.emptyUnnamedOr}</span>{' '}
          <button
            onClick={onAdd}
            className="font-semibold"
            style={{ color: C.blueDeep }}
          >
            {t.emptyUnnamedEscape}
          </button>
        </p>
      </section>

      <section
        className="mt-6"
        style={{ borderTop: `1px solid ${C.ink}`, paddingTop: '16px' }}
      >
        <h3
          className="font-bold"
          style={{ color: C.blue, fontSize: '10.5px', letterSpacing: '0.24em' }}
        >
          {t.emptyUnnamedSimKicker}
        </h3>
        <button
          onClick={onStartSim}
          className="mt-3 block w-full text-left"
          style={{ backgroundColor: C.soft, padding: '22px', borderRadius: 0 }}
        >
          <p className="font-bold" style={{ fontSize: '18px', lineHeight: 1.4 }}>
            {t.sim}
          </p>
          <p className="mt-2" style={{ color: C.sub, fontSize: '12.5px', lineHeight: 1.8 }}>
            {t.emptyUnnamedSimDesc}
          </p>
          <span
            className="mt-4 inline-flex items-center gap-1 font-semibold"
            style={{ color: C.blueDeep, fontSize: '13px' }}
          >
            {t.startSim}
            <ChevronRight size={15} />
          </span>
        </button>
      </section>
    </div>
  );
}
