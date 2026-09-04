import { C, FONT } from '../../constants/theme.js';

/* ---------------- sheets ---------------- */

/* 新增收據／收據詳情：整頁覆蓋，自己的標題列 */
export function FullScreenSheet({ children }) {
  return (
    <div
      className="fixed inset-0 z-40 overflow-y-auto"
      style={{
        backgroundColor: C.bg,
        fontFamily: FONT,
        letterSpacing: '0.01em',
        color: C.ink,
      }}
    >
      <div
        className="kaeru-app"
        style={{ backgroundColor: C.page, paddingBottom: '40px' }}
      >
        {children}
      </div>
    </div>
  );
}
