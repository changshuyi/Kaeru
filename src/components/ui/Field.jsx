import { C } from '../../constants/theme.js';

export function Field({ label, hint, children, as: As = 'label' }) {
  return (
    <As className="block">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <span
          className="font-bold"
          style={{ color: C.blue, fontSize: '10.5px', letterSpacing: '0.22em' }}
        >
          {label}
        </span>
        {hint && (
          <span className="text-xs" style={{ color: C.sub }}>
            {hint}
          </span>
        )}
      </div>
      {children}
    </As>
  );
}
