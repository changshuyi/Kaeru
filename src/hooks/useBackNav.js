import { useEffect, useRef, useState } from 'react';

/* ------------------------------------------------------------------
   返回鍵／左緣滑動／畫面上「‹」統一處理。

   用 history.pushState 當「還疊著幾層 sheet/面板」的唯一真相：每打開
   一層（sheet、面板、非總覽的分頁）就 push 一筆，帶一個獨一無二的
   token；popstate 一律只關「目前 token 等於全域深度」那一層，一次
   只退一層。手機硬體返回鍵（Android，透過 @capacitor/app 轉成
   history.back()）跟左緣滑動（iOS，WKWebView 手勢本來就是操作同一份
   history）都會變成 popstate，跟畫面上按鈕點的「返回/‹/✕」走同一條
   路——按鈕關閉時該層會主動呼叫 history.back() 把自己那筆吃掉，
   避免堆疊跟瀏覽器 history 長度兜不起來。
------------------------------------------------------------------ */
export let kaeruBackDepth = 0;
const kaeruBackHandlers = new Set();
// 有一層自己主動關（按了畫面上的按鈕/元件被拿掉）時，會呼叫
// history.back() 把自己那筆 entry 吃掉，讓深度跟畫面對齊——但這樣
// 一來也會產生一個「真的」popstate 事件。如果照樣把這個 popstate
// 廣播給所有還在監聽的 handler，「現在變成最上層」的那一層（通常是
// 剛關掉那層的父層）會誤判成「輪到我被使用者按返回關掉了」，然後
// 也跟著關掉——結果是關一層、自動連著再關一層，甚至讓有未存變動的
// 表單以為使用者要放棄。這個計數器記錄「接下來有幾個 popstate 是
// 我們自己 history.back() 造成的、不是使用者真的按返回/滑動」，
// 廣播前先扣掉，扣得到就直接吞掉，不發給任何 handler。
let kaeruSuppressPop = 0;

export function useBackClose(isOpen, onClose) {
  const depthRef = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  // 這一層在畫面上的存在方式有兩種：整個元件只在開著時才掛載（掛上=
  // 開、拿掉=關，這個 app 大部分 sheet 都是這樣），或是元件本身一直
  // 掛著、isOpen 這個 prop 自己在 true/false 之間切換（例如總覽以外
  // 的分頁）。兩種都靠同一個 effect 處理：開的時候 push 一筆，「關」
  // 不管是因為 isOpen 變 false 還是元件被整個拿掉，都會讓這個 effect
  // 的 cleanup 跑一次，在 cleanup 裡把那筆 history entry 吃掉——不用
  // 另外去偵測「isOpen 從 true 變 false」，unmount 本來就會觸發 cleanup。
  useEffect(() => {
    if (!isOpen) return;
    kaeruBackDepth += 1;
    const myDepth = kaeruBackDepth;
    depthRef.current = myDepth;
    window.history.pushState({ kaeruDepth: myDepth }, '');

    function handlePop() {
      // 一定要連 kaeruBackDepth（全域「目前最上層是誰」）一起比對，
      // 只比 depthRef.current === myDepth 是不夠的——那個條件只代表
      // 「這一層還沒被關過」，任何還開著的層都會通過，一次 popstate
      // 會把所有還開著的層通通關掉，不是只關最上面那一層。
      if (depthRef.current === myDepth && kaeruBackDepth === myDepth) {
        depthRef.current = null;
        kaeruBackDepth -= 1;
        closeRef.current();
      }
    }
    kaeruBackHandlers.add(handlePop);

    return () => {
      kaeruBackHandlers.delete(handlePop);
      // depthRef.current 還是 myDepth，代表這層不是被 popstate 關掉
      // 的（是按了畫面上的按鈕，或元件被拿掉）——把剛剛推的那筆吃掉，
      // 讓堆疊深度跟畫面對齊，同時記一筆「這個 popstate 不用發給任何
      // handler」，避免波及現在變成最上層的那一層。
      if (depthRef.current === myDepth) {
        depthRef.current = null;
        if (kaeruBackDepth === myDepth) kaeruBackDepth -= 1;
        if (window.history.state && window.history.state.kaeruDepth === myDepth) {
          kaeruSuppressPop += 1;
          window.history.back();
        }
      }
    };
  }, [isOpen]);
}

if (typeof window !== 'undefined') {
  window.addEventListener('popstate', () => {
    if (kaeruSuppressPop > 0) {
      kaeruSuppressPop -= 1;
      return;
    }
    for (const fn of kaeruBackHandlers) fn();
  });
}

// 新增收據／編輯行程／裁切照片這三個表單共用：返回（不管是按鈕、
// 硬體返回鍵還是滑動）時如果有還沒存的變動，先問要不要放棄，不要
// 直接丟掉。選「繼續編輯」要讓這一層重新排回 history 堆疊最上面，
// 不然下一次返回會找不到人接——靠 gen 這個世代計數器強迫
// useBackClose 的 effect 重新跑一次（同一層再 push 一筆新的）。
export function useDirtyBackGuard(isDirty, onClose) {
  const [discardOpen, setDiscardOpen] = useState(false);
  const [gen, setGen] = useState(0);
  const isDirtyRef = useRef(isDirty);
  isDirtyRef.current = isDirty;

  function requestClose() {
    if (isDirtyRef.current) {
      setDiscardOpen(true);
      setGen((g) => g + 1);
    } else {
      onClose();
    }
  }

  useBackClose(`kaeruLayer:${gen}`, requestClose);

  return {
    discardOpen,
    requestClose,
    keepEditing: () => setDiscardOpen(false),
    discard: () => {
      setDiscardOpen(false);
      onClose();
    },
  };
}


// 「關掉這一層、換開另一層」（例如選單→行程切換面板）如果兩個
// setState 落在同一次 React commit，關閉那層的 history.back() 跟開啟
// 那層的 history.pushState 會搶在同一個 tick 裡執行——history.back()
// 的實際 popstate 是排到之後才觸發的，如果 pushState 在它完成之前就
// 搶先執行，History API 沒有保證這種混用的順序（實測過：用固定的
// setTimeout(0) 延遲不夠保險，pushState 有時還是搶在 popstate 前面
// 執行，導致堆疊深度跟畫面兜不起來）。改成真的等那個 popstate 先
// 觸發完，才執行「開新的那一半」；如果這次關閉根本沒有觸發
// history.back()（沒有東西可吃），用一個短逾時保底，不要卡死。
export function deferOpen(fn) {
  let done = false;
  function run() {
    if (done) return;
    done = true;
    window.removeEventListener('popstate', onPop);
    clearTimeout(timer);
    fn();
  }
  function onPop() {
    run();
  }
  window.addEventListener('popstate', onPop);
  const timer = setTimeout(run, 60);
}
