import { ChevronRight } from 'lucide-react';
import { C } from '../../constants/theme.js';

// 倒數區的標籤／數字三態（倒數中／已出境／沒設回程時間），總覽正常
// 畫面跟畫面 39（已命名但沒收據）共用同一份——沒收據不代表倒數跟
// 查驗進度的邏輯不算，畫面 39 的截圖本來就有倒數，只是下面接的內容
// 不一樣。
export function CountdownDisplay({ t, dep, diffMs, dDays, dHours, departed, onGoSettings }) {
  if (departed) {
    return (
      <>
        <p style={{ color: C.sub, fontSize: '10.5px', letterSpacing: '0.24em' }}>
          {t.departedTopLabel}
        </p>
        <p className="mt-2" style={{ lineHeight: 1 }}>
          <span className="kaeru-bignum font-semibold" style={{ color: C.ink }}>
            {t.departedValue}
          </span>
        </p>
      </>
    );
  }
  if (dep && diffMs > 0) {
    // 回程班機起飛前 24 小時內，天數已經沒有意義（永遠是 0），改顯示
    // 小時＋分——dHours 傳進來的時候本來就是「扣掉天數後剩下的小時」，
    // 24 小時內天數必為 0，所以這個值本身已經等於總小時數，不用另外算。
    const within24h = diffMs <= 24 * 3600 * 1000;
    const dMinutes = Math.floor((diffMs % 3600000) / 60000);
    return (
      <>
        <p style={{ color: C.sub, fontSize: '10.5px', letterSpacing: '0.24em' }}>
          {t.departIn}
        </p>
        <p
          className="mt-2 flex items-baseline tabular-nums"
          style={{ letterSpacing: '-0.01em' }}
        >
          <span className="kaeru-bignum font-semibold" style={{ color: C.ink, lineHeight: 1 }}>
            {within24h ? dHours : dDays}
          </span>
          <span
            style={{
              color: C.ink,
              fontSize: '16px',
              fontWeight: 500,
              marginLeft: '4px',
              marginRight: '12px',
            }}
          >
            {within24h ? t.hours : t.days}
          </span>
          <span className="kaeru-bignum font-semibold" style={{ color: C.ink, lineHeight: 1 }}>
            {within24h ? dMinutes : dHours}
          </span>
          <span
            style={{ color: C.ink, fontSize: '16px', fontWeight: 500, marginLeft: '4px' }}
          >
            {within24h ? t.min : t.hours}
          </span>
        </p>
      </>
    );
  }
  return (
    <button
      onClick={onGoSettings}
      className="flex w-full items-center justify-between text-left"
    >
      <span>
        <span className="block text-base font-semibold">{t.setDeparture}</span>
        <span className="mt-1 block text-xs" style={{ color: C.sub }}>
          {t.beforeCheckin}
        </span>
      </span>
      <ChevronRight size={18} style={{ color: C.sub }} />
    </button>
  );
}
