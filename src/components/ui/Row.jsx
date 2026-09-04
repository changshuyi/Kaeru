import { C } from '../../constants/theme.js';

export function Row({ label, sub, last, align = 'center', children }) {
  return (
    <div
      className="flex justify-between gap-3 py-3"
      style={{
        borderBottom: last ? 'none' : `1px solid ${C.line}`,
        alignItems:
          align === 'end'
            ? 'flex-end'
            : align === 'baseline'
              ? 'baseline'
              : 'center',
      }}
    >
      <span>
        <span className="block" style={{ color: C.sub, fontSize: '12.5px' }}>
          {label}
        </span>
        {sub && (
          <span
            className="mt-0.5 block tabular-nums"
            style={{ color: C.sub, fontSize: '11px' }}
          >
            {sub}
          </span>
        )}
      </span>
      <span className="flex items-center" style={{ gap: '9px' }}>
        {children}
      </span>
    </div>
  );
}

