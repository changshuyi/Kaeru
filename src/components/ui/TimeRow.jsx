import { C } from '../../constants/theme.js';
import { pad2 } from '../../lib/date.js';

export function TimeRow({ value, onChange, t }) {
  const [hh, mm] = (value || '00:00').split(':');
  const sel = {
    backgroundColor: '#FFFFFF',
    border: `1px solid ${C.line}`,
    color: C.ink,
    fontFamily: 'inherit',
  };
  return (
    <div
      className="mt-4 flex items-center gap-2"
      style={{ borderTop: `1px solid ${C.line}`, paddingTop: '1rem' }}
    >
      <span className="text-xs" style={{ color: C.sub }}>
        {t.time}
      </span>
      <select
        value={hh}
        onChange={(e) => onChange(`${e.target.value}:${mm}`)}
        className="rounded-lg px-2 py-1.5 text-sm tabular-nums outline-none"
        style={sel}
      >
        {Array.from({ length: 24 }, (_, i) => pad2(i)).map((h) => (
          <option key={h} value={h}>
            {h}
          </option>
        ))}
      </select>
      <span style={{ color: C.sub }}>:</span>
      <select
        value={mm}
        onChange={(e) => onChange(`${hh}:${e.target.value}`)}
        className="rounded-lg px-2 py-1.5 text-sm tabular-nums outline-none"
        style={sel}
      >
        {Array.from({ length: 12 }, (_, i) => pad2(i * 5)).map((x) => (
          <option key={x} value={x}>
            {x}
          </option>
        ))}
      </select>
    </div>
  );
}

