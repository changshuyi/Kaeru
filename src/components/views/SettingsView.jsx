import { ChevronRight } from 'lucide-react';
import { C } from '../../constants/theme.js';
import { Badge } from '../ui/Badge.jsx';

export function SettingsView({
  t,
  settings,
  setSettings,
  trip,
  count,
  onEditTrip,
  onFetchRate,
  rateBusy,
  rateErr,
  onOpenDataManage,
  onOpenAbout,
}) {
  const rowStyle = (first) => ({
    display: 'block',
    width: '100%',
    textAlign: 'left',
    padding: '18px 0',
    borderBottom: `1px solid ${C.line}`,
    borderTop: first ? `1px solid ${C.ink}` : 'none',
  });
  const labelStyle = {
    color: C.blue,
    fontSize: '10.5px',
    letterSpacing: '0.24em',
    fontWeight: 700,
  };

  return (
    <div className="pb-6 pt-2">
      <button onClick={onEditTrip} style={rowStyle(true)}>
        <span className="block" style={labelStyle}>
          {t.trips}
        </span>
        <span className="mt-2 flex items-center justify-between gap-2">
          <span style={{ fontSize: '17px' }}>
            {trip && trip.name ? trip.name : t.tripNow}
          </span>
          <span className="flex shrink-0 items-center gap-1.5">
            <Badge tone="blue">{t.tripNow}</Badge>
            <span
              className="flex items-center tabular-nums"
              style={{ color: C.sub, fontSize: '11.5px' }}
            >
              {count} {t.itemsUnit} <ChevronRight size={13} />
            </span>
          </span>
        </span>
      </button>

      <div style={rowStyle(false)}>
        <div className="flex items-baseline justify-between gap-2">
          <span style={labelStyle}>
            {t.rate} {t.twd}
          </span>
          <button
            onClick={onFetchRate}
            disabled={rateBusy}
            className="shrink-0 text-xs disabled:opacity-50"
            style={{ color: C.blueDeep, textDecoration: 'underline' }}
          >
            {rateBusy ? t.fetching : t.fetchRate}
          </button>
        </div>
        <input
          type="number"
          step="0.0001"
          min="0"
          value={settings.rate}
          onChange={(e) =>
            setSettings((s) => ({
              ...s,
              // #13 修正：原本沒有防呆，可以打負數匯率，會讓所有 NT$
              // 換算的地方顯示負的台幣金額。夾在 0 以上。
              rate: Math.max(0, Number(e.target.value) || 0),
              rateAt: null,
            }))
          }
          className="mt-2 block w-full bg-transparent font-semibold tabular-nums outline-none"
          style={{ border: 'none', fontSize: '17px', color: C.ink }}
        />
        <p className="mt-1 text-xs" style={{ color: C.sub }}>
          {settings.rateAt
            ? `${t.rateAt} ${(() => {
                const d = new Date(settings.rateAt);
                return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
              })()}`
            : t.manual}
        </p>
        {rateErr && (
          <p className="mt-1.5 text-xs" style={{ color: C.clayInk }}>
            {t.rateFail}
          </p>
        )}
      </div>

      <div style={rowStyle(false)}>
        <span className="block" style={labelStyle}>
          {t.language}
        </span>
        <div className="mt-2.5 flex gap-6">
          {[
            ['zh', '繁體中文'],
            ['ja', '日本語'],
          ].map(([k, label]) => (
            <button
              key={k}
              onClick={() => setSettings((s) => ({ ...s, lang: k }))}
              className="pb-1.5"
              style={{
                fontSize: '15px',
                fontWeight: settings.lang === k ? 700 : 400,
                color: settings.lang === k ? C.ink : C.sub,
                borderBottom:
                  settings.lang === k
                    ? `2px solid ${C.ink}`
                    : '2px solid transparent',
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <button onClick={onOpenDataManage} style={rowStyle(false)}>
        <span className="block" style={labelStyle}>
          {t.dataManageKicker}
        </span>
        <span className="mt-2 flex items-center justify-between gap-2">
          <span style={{ fontSize: '17px' }}>{t.dataManageTitle}</span>
          <ChevronRight size={15} style={{ color: C.sub, flexShrink: 0 }} />
        </span>
        <p className="mt-1.5" style={{ color: C.sub, fontSize: '12px', lineHeight: 1.7 }}>
          {t.dataManageRowDesc}
        </p>
      </button>

      <button
        onClick={onOpenAbout}
        className="flex w-full items-center justify-between gap-2"
        style={rowStyle(false)}
      >
        <span style={{ fontSize: '15px', color: C.ink }}>{t.aboutRowLabel}</span>
        <ChevronRight size={15} style={{ color: C.sub, flexShrink: 0 }} />
      </button>

      <p
        className="mt-10 pb-2 text-center"
        style={{ color: C.sub, fontSize: '10.5px' }}
      >
        {t.source}
      </p>
    </div>
  );
}
