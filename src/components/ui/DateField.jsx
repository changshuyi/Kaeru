import { useState } from 'react';
import { Calendar as CalIcon } from 'lucide-react';
import { C } from '../../constants/theme.js';
import { dateOf, timeOf, todayStr } from '../../lib/date.js';
import { Calendar } from './Calendar.jsx';
import { TimeRow } from './TimeRow.jsx';

export function DateField({ value, onChange, t, withTime, fontSize = '16px' }) {
  const [open, setOpen] = useState(false);
  const label = value
    ? withTime
      ? `${dateOf(value).replace(/-/g, '/')}  ${timeOf(value) || '00:00'}`
      : dateOf(value).replace(/-/g, '/')
    : withTime
      ? t.pickDateTime
      : t.pickDate;

  const set = (d, tm) => {
    if (!d) return onChange('');
    onChange(withTime ? `${d}T${tm || timeOf(value) || '00:00'}` : d);
  };

  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between pb-2.5 text-left"
        style={{
          borderBottom: `1px solid ${open ? C.ink : C.line}`,
          color: value ? C.ink : C.sub,
        }}
      >
        <span className="font-semibold tabular-nums" style={{ fontSize }}>
          {label}
        </span>
        <CalIcon size={16} style={{ color: C.sub }} />
      </button>

      {open && (
        <div
          className="mt-2 p-3.5"
          style={{
            backgroundColor: C.soft,
            border: `1px solid ${C.line}`,
            borderRadius: 0,
          }}
        >
          <Calendar value={value} onPick={(d) => set(d)} t={t} />
          {withTime && (
            <TimeRow
              value={timeOf(value) || '00:00'}
              onChange={(tm) => set(dateOf(value) || todayStr(), tm)}
              t={t}
            />
          )}
          <div className="mt-4 flex gap-2">
            <button
              onClick={() => set(todayStr())}
              className="flex-1 py-2 text-xs"
              style={{
                border: `1px solid ${C.line}`,
                color: C.ink,
                backgroundColor: '#FFFFFF',
                borderRadius: 0,
              }}
            >
              {t.today}
            </button>
            <button
              onClick={() => onChange('')}
              className="flex-1 py-2 text-xs"
              style={{
                border: `1px solid ${C.line}`,
                color: C.sub,
                backgroundColor: '#FFFFFF',
                borderRadius: 0,
              }}
            >
              {t.clearDate}
            </button>
            <button
              onClick={() => setOpen(false)}
              className="flex-1 py-2 text-xs font-medium"
              style={{
                backgroundColor: C.blue,
                color: '#FFFFFF',
                borderRadius: 0,
              }}
            >
              {t.doneDate}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
