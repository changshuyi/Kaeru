import { C } from '../../constants/theme.js';

/* ---------------- primitives ---------------- */

export function FrogMark({ size = 30, color = C.sage, bg = C.page }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      role="img"
      aria-label="Kaeru"
    >
      {/* 頭部正面 */}
      <path
        d="M2.4 13.6C2.4 9.2 6.7 6.1 12 6.1s9.6 3.1 9.6 7.5c0 3.3-4.3 5.6-9.6 5.6s-9.6-2.3-9.6-5.6z"
        fill={color}
      />
      {/* 兩顆隆起的眼球 */}
      <circle cx="7.2" cy="6.3" r="3.5" fill={color} />
      <circle cx="16.8" cy="6.3" r="3.5" fill={color} />
      <circle cx="7.2" cy="5.9" r="1.35" fill={bg} />
      <circle cx="16.8" cy="5.9" r="1.35" fill={bg} />
      <circle cx="7.4" cy="5.9" r="0.62" fill={color} />
      <circle cx="16.6" cy="5.9" r="0.62" fill={color} />
      {/* 鼻孔 */}
      <circle cx="10.6" cy="11.4" r="0.55" fill={bg} opacity="0.7" />
      <circle cx="13.4" cy="11.4" r="0.55" fill={bg} opacity="0.7" />
      {/* 嘴 */}
      <path
        d="M6.6 14.1c1.9 2.4 8.9 2.4 10.8 0"
        stroke={bg}
        strokeWidth="0.95"
        strokeLinecap="round"
        fill="none"
        opacity="0.5"
      />
    </svg>
  );
}
