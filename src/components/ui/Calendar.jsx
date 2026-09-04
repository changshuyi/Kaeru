import { useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { C } from '../../constants/theme.js';
import { pad2, dateOf, todayStr } from '../../lib/date.js';

export function Calendar({ value, onPick, t }) {
  const seed = value ? new Date(dateOf(value) + 'T00:00:00') : new Date();
  const [view, setView] = useState(
    new Date(seed.getFullYear(), seed.getMonth(), 1),
  );

  const y = view.getFullYear();
  const m = view.getMonth();
  const first = new Date(y, m, 1).getDay();
  const total = new Date(y, m + 1, 0).getDate();
  const selected = dateOf(value);
  const today = todayStr();

  const cells = [];
  for (let i = 0; i < first; i++) cells.push(null);
  for (let d = 1; d <= total; d++) cells.push(d);

  const shift = (n) => setView(new Date(y, m + n, 1));

  return (
    <div>
      <div className="flex items-center justify-between">
        <button
          onClick={() => shift(-1)}
          className="rounded-lg p-1.5"
          style={{ color: C.sub }}
        >
          <ChevronLeft size={16} />
        </button>
        <span className="text-sm font-bold tabular-nums">
          {y} / {pad2(m + 1)}
        </span>
        <button
          onClick={() => shift(1)}
          className="rounded-lg p-1.5"
          style={{ color: C.sub }}
        >
          <ChevronRight size={16} />
        </button>
      </div>

      <div className="mt-3 grid grid-cols-7 gap-y-1">
        {t.weekdays.map((w, i) => (
          <span
            key={i}
            className="pb-1 text-center text-xs"
            style={{ color: C.sub }}
          >
            {w}
          </span>
        ))}
        {cells.map((d, i) => {
          if (d === null) return <span key={i} />;
          const iso = `${y}-${pad2(m + 1)}-${pad2(d)}`;
          const on = iso === selected;
          const isToday = iso === today;
          return (
            <button
              key={i}
              onClick={() => onPick(iso)}
              className="mx-auto flex h-8 w-8 items-center justify-center rounded-full text-sm tabular-nums"
              style={{
                backgroundColor: on ? C.blue : 'transparent',
                color: on ? '#FFFFFF' : C.ink,
                border:
                  !on && isToday
                    ? `1px solid ${C.blue}`
                    : '1px solid transparent',
              }}
            >
              {d}
            </button>
          );
        })}
      </div>
    </div>
  );
}

