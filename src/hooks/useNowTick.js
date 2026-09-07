import { useEffect, useState } from 'react';

// 首頁倒數（幾天幾小時）本身沒有 setInterval，dDays/dHours 只有在畫面
// 因為別的原因重新 render 時才會跟著重算一次——使用者把首頁開著不動，
// 倒數會停在打開那一刻，不會自然往下跳。這個 hook 每分鐘強迫重新
// render 一次，讓倒數自己會動；小時以下的精細度用不到，一分鐘夠了。
export function useNowTick(intervalMs = 60000) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
}
