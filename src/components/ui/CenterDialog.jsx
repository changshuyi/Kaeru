import { C, FONT } from '../../constants/theme.js';

// 置中對話框——整個 App 目前只有刪除確認（畫面 60）用這個版面，跟
// BottomSheet（貼底）刻意做成不同形狀：這是唯一一個要使用者在動手
// 之前先「停下來讀完」的畫面，貼底 sheet 那種「隨手往下滑就關掉」
// 的手感不適合放在這裡。
export function CenterDialog({ onClose, children }) {
  return (
    <div
      className="fixed inset-0 z-40"
      style={{ fontFamily: FONT, letterSpacing: '0.01em', color: C.ink }}
    >
      <div className="absolute inset-0 kaeru-app">
        <div
          className="absolute inset-0"
          style={{ backgroundColor: 'rgba(73,70,64,0.32)' }}
          onClick={onClose}
        />
        <div
          onClick={(e) => e.stopPropagation()}
          className="absolute overflow-y-auto"
          style={{
            left: '20px',
            right: '20px',
            top: '50%',
            transform: 'translateY(-50%)',
            maxHeight: '80vh',
            backgroundColor: C.page,
            border: `1px solid ${C.ink}`,
            borderRadius: 0,
            padding: '24px 22px',
          }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
