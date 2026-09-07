import { AlertTriangle } from 'lucide-react';
import { C } from '../../constants/theme.js';

export function Notice({ tone = 'clay', children }) {
  const s =
    tone === 'clay'
      ? { bg: C.claySoft, fg: C.clayInk }
      : { bg: C.blueSoft, fg: C.blueDeep };
  return (
    <p
      className="flex gap-2 rounded-xl p-3 text-xs leading-relaxed"
      style={{ backgroundColor: s.bg, color: s.fg }}
    >
      <AlertTriangle size={15} className="mt-0.5 shrink-0" />
      <span>{children}</span>
    </p>
  );
}
