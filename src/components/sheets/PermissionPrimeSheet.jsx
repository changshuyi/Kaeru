import { C } from '../../constants/theme.js';
import { FullScreenSheet } from '../ui/FullScreenSheet.jsx';
import { FrogMark } from '../ui/FrogMark.jsx';
import { SectionLabel } from '../ui/SectionLabel.jsx';

// 共用的「來源選擇面板」＋「確認/裁切畫面」，接 usePhotoCapture 回傳的 cap。
// onConfirmCancelled 是選填的——只有 QuickAddFlow 需要，見下面該元件裡
// 的說明；EditSheet／DetailSheet 不傳，維持原本「關掉確認畫面就回表單」
// 的行為不變。
// 畫面 55：權限說明。第一次要用相機或相簿前出現，不是 App 一開就跳
// ——使用者對相簿權限的預設懷疑是「你要拿去幹什麼」，「就這樣。沒有
// 第三步」把清單封口比多寫三行保證有效。拒絕的路要留得體面：照片本
// 來就是選填的，「先不要」不是降級體驗，不用警告語氣、不用 clay。
export function PermissionPrimeSheet({ t, onAllow, onDecline }) {
  return (
    <FullScreenSheet>
      <div className="kaeru-pad py-6">
        <div className="flex items-center gap-2">
          <FrogMark size={30} />
          <span
            className="font-bold"
            style={{ fontSize: '12.5px', letterSpacing: '0.28em', color: C.blueDeep }}
          >
            KAERU
          </span>
        </div>

        <h1 className="mt-5 font-bold" style={{ fontSize: '22px', color: C.ink, lineHeight: 1.4 }}>
          {t.permissionPrimeTitle}
        </h1>
        <p className="mt-2.5" style={{ fontSize: '13px', color: C.sub, lineHeight: 1.85 }}>
          {t.permissionPrimeDesc}
        </p>

        <div className="mt-6" style={{ borderTop: `1px solid ${C.ink}`, paddingTop: '16px' }}>
          <SectionLabel>{t.permissionPrimeDoKicker}</SectionLabel>
          <ol className="mt-3" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {[t.permissionPrimeDo1, t.permissionPrimeDo2, t.permissionPrimeDo3].map((line, i) => (
              <li key={i} className="flex gap-3">
                <span
                  className="shrink-0 font-bold tabular-nums"
                  style={{ color: C.blue, opacity: 0.7, fontSize: '11px' }}
                >
                  {String(i + 1).padStart(2, '0')}
                </span>
                <p style={{ fontSize: '12.5px', lineHeight: 1.8, color: C.ink }}>{line}</p>
              </li>
            ))}
          </ol>
        </div>

        <div className="mt-5" style={{ borderTop: `1px solid ${C.line}`, paddingTop: '16px' }}>
          <SectionLabel>{t.permissionPrimeDontKicker}</SectionLabel>
          <ol className="mt-3" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {[t.permissionPrimeDont1, t.permissionPrimeDont2, t.permissionPrimeDont3].map((line, i) => (
              <li key={i} className="flex gap-3">
                <span
                  className="shrink-0 font-bold tabular-nums"
                  style={{ color: C.blue, opacity: 0.7, fontSize: '11px' }}
                >
                  {String(i + 1).padStart(2, '0')}
                </span>
                <p style={{ fontSize: '12.5px', lineHeight: 1.8, color: C.ink }}>{line}</p>
              </li>
            ))}
          </ol>
        </div>

        <div className="mt-6" style={{ backgroundColor: C.soft, padding: '14px' }}>
          <p className="font-bold" style={{ fontSize: '13px', color: C.ink }}>
            {t.permissionPrimeOptionalTitle}
          </p>
          <p className="mt-1.5" style={{ color: C.sub, fontSize: '11.5px', lineHeight: 1.8 }}>
            {t.permissionPrimeOptionalDesc}
          </p>
        </div>

        <div className="mt-6">
          <button
            onClick={onAllow}
            className="w-full py-3.5 text-sm font-semibold"
            style={{ backgroundColor: C.blue, color: '#FFFFFF' }}
          >
            {t.permissionPrimeAllowCta}
          </button>
          <button
            onClick={onDecline}
            className="mt-3 w-full text-center font-semibold"
            style={{ fontSize: '12.5px', color: C.blueDeep }}
          >
            {t.permissionPrimeDeclineCta}
          </button>
        </div>
      </div>
    </FullScreenSheet>
  );
}
