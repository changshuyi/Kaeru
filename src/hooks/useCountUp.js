import { useEffect, useRef, useState } from 'react';

export function useCountUp(target, ms = 500) {
  const [n, setN] = useState(target);
  const from = useRef(target);
  // 追蹤「畫面上現在顯示的數字」，不只是動畫跑完才更新的 from.current
  // ——動畫還沒跑完 target 又變了（例如很快連續答完兩題）時，effect
  // 會被提早清掉，這時要接著目前畫面上的數字繼續跑，不能回去用這次
  // 動畫開始前的舊起點，不然數字會先跳回很久以前的值再重新跑，看起來
  // 像卡了一下。
  const lastShown = useRef(target);
  useEffect(() => {
    const start = performance.now();
    const a = from.current;
    const b = target;
    if (a === b) return;
    let raf;
    const tick = (now) => {
      const p = Math.min(1, (now - start) / ms);
      const e = 1 - Math.pow(1 - p, 3);
      const value = Math.round(a + (b - a) * e);
      lastShown.current = value;
      setN(value);
      if (p < 1) raf = requestAnimationFrame(tick);
      else from.current = b;
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      from.current = lastShown.current;
    };
  }, [target, ms]);
  return n;
}

