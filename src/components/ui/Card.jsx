import { C } from '../../constants/theme.js';

export function Card({ children, style, ...rest }) {
  return (
    <div
      {...rest}
      className={`py-4 ${rest.className || ''}`}
      style={{ borderTop: `1px solid ${C.line}`, ...style }}
    >
      {children}
    </div>
  );
}
