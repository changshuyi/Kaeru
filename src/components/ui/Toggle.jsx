import { C } from '../../constants/theme.js';

export function Toggle({ checked, onChange, label, hint, warn }) {
  const on = checked;
  const bg = warn ? (on ? C.claySoft : '#FFFFFF') : on ? C.blueSoft : '#FFFFFF';
  const bd = warn ? C.clay : on ? C.blue : C.line;
  const fg = warn ? C.clayInk : on ? C.blueDeep : C.ink;
  return (
    <button
      onClick={() => onChange(!checked)}
      className="flex w-full items-center justify-between gap-3 text-left"
      style={{
        backgroundColor: bg,
        border: `1px solid ${bd}`,
        borderRadius: 0,
        padding: '13px 14px',
      }}
    >
      <span>
        <span className="block" style={{ color: fg, fontSize: '15px' }}>
          {label}
        </span>
        {hint && (
          <span className="mt-0.5 block text-xs" style={{ color: C.sub }}>
            {hint}
          </span>
        )}
      </span>
      <span
        className="relative shrink-0"
        style={{
          width: '34px',
          height: '18px',
          backgroundColor: on ? (warn ? C.clay : C.blue) : C.line,
          borderRadius: 0,
        }}
      >
        <span
          className="absolute transition-transform"
          style={{
            top: '2px',
            left: '2px',
            width: '14px',
            height: '14px',
            backgroundColor: '#FFFFFF',
            transform: on ? 'translateX(16px)' : 'translateX(0)',
          }}
        />
      </span>
    </button>
  );
}
