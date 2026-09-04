import { C, FONT } from '../../constants/theme.js';

/* 行程切換：貼底 bottom sheet，不做圓角 */
export function BottomSheet({ onClose, children }) {
  return (
    <div
      className="fixed inset-0 z-40"
      style={{ fontFamily: FONT, letterSpacing: '0.01em', color: C.ink }}
    >
      <style>{`@keyframes jpSlideUp{from{transform:translateY(12px);opacity:0}to{transform:none;opacity:1}}`}</style>
      {/* 面板固定在「欄」內，不是整個 viewport：寬度／置中沿用 .kaeru-app 同一套規則 */}
      <div className="absolute inset-0 kaeru-app">
        <div
          className="absolute inset-0"
          style={{ backgroundColor: 'rgba(73,70,64,0.28)' }}
          onClick={onClose}
        />
        <div
          onClick={(e) => e.stopPropagation()}
          className="absolute inset-x-0 bottom-0 overflow-y-auto"
          style={{
            maxHeight: '86vh',
            backgroundColor: C.page,
            borderTop: `1px solid ${C.ink}`,
            borderRadius: 0,
            padding: '22px 26px max(30px, calc(env(safe-area-inset-bottom) + 14px))',
            animation: 'jpSlideUp 200ms cubic-bezier(0.4,0,0.2,1)',
          }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
