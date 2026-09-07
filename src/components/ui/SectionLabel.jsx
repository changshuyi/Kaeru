import { C } from '../../constants/theme.js';

export function SectionLabel({ children }) {
  return (
    <div className="flex items-center gap-2.5">
      <h3
        className="font-bold"
        style={{ color: C.blue, fontSize: '10.5px', letterSpacing: '0.22em' }}
      >
        {children}
      </h3>
    </div>
  );
}

