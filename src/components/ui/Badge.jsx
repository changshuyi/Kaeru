import { C } from '../../constants/theme.js';

export function Badge({ tone = 'line', size = 'md', children }) {
  const map = {
    line: { bg: C.soft, fg: C.sub },
    clay: { bg: C.clay, fg: '#FFFFFF' },
    sage: { bg: C.sage, fg: '#FFFFFF' },
    blue: { bg: C.blue, fg: '#FFFFFF' },
    outline: { bg: 'transparent', fg: C.sub, bd: C.line },
    mute: { bg: 'transparent', fg: C.sub, bd: C.sub },
  };
  const s = map[tone];
  const outlineLike = tone === 'outline' || tone === 'mute';
  const padding =
    size === 'lg' ? '4px 8px' : outlineLike ? '2px 6px' : '3px 7px';
  const fontSize = size === 'lg' ? '10.5px' : '10px';
  return (
    <span
      className="inline-flex items-center gap-1 font-semibold"
      style={{
        backgroundColor: s.bg,
        color: s.fg,
        fontSize,
        padding,
        borderRadius: '3px',
        border: s.bd ? `1px solid ${s.bd}` : '1px solid transparent',
      }}
    >
      {children}
    </span>
  );
}
