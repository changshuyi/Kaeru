import { ChevronRight } from 'lucide-react';
import { C } from '../../constants/theme.js';

export function FaqRow({ item, lang, open, onToggle }) {
  return (
    <div style={{ borderTop: `1px solid ${C.line}` }}>
      <button
        onClick={onToggle}
        className="flex w-full items-start justify-between gap-4 text-left"
        style={{ padding: '15px 0' }}
      >
        <span style={{ fontSize: '15px', lineHeight: 1.7 }}>
          {item.q[lang]}
        </span>
        <ChevronRight
          size={16}
          className="mt-1 shrink-0"
          style={{
            color: C.sub,
            transform: open ? 'rotate(90deg)' : 'none',
            transition: 'transform 150ms',
          }}
        />
      </button>
      {open && (
        <p
          style={{
            color: C.sub,
            fontSize: '13px',
            lineHeight: 2,
            margin: '0 24px 20px 0',
          }}
        >
          {item.a[lang]}
        </p>
      )}
    </div>
  );
}
