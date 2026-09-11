import { useEffect, useMemo, useRef, useState } from 'react';
import { Rows3, Plus, X, ChevronRight, CheckCircle2, Menu } from 'lucide-react';
import { Capacitor } from '@capacitor/core';
import { App as CapacitorApp } from '@capacitor/app';
import {
  photoKey,
  normalizePhotoList,
  isTripEnded,
  collectAllPhotos,
  photoStatsFrom,
} from './exportData.js';
import { C, FONT } from './constants/theme.js';
import { MAIN_KEY } from './constants/app.js';
import { T } from './i18n/translations.js';
import { netOfItem } from './lib/money.js';
import { groupKey, daysLeft, isPendingInfo, isExpiredUnclaimed } from './lib/date.js';
import { genTripId } from './lib/trip.js';
import { useBackClose, deferOpen, kaeruBackDepth } from './hooks/useBackNav.js';
import { FrogMark } from './components/ui/FrogMark.jsx';
import { HomeView } from './components/views/HomeView.jsx';
import { TripEndedSheet } from './components/views/TripEndedSheet.jsx';
import { DeadlineWarnSheet } from './components/views/DeadlineWarnSheet.jsx';
import { RefundCheckSheet } from './components/views/RefundCheckSheet.jsx';
import { ListView } from './components/views/ListView.jsx';
import { CheckView } from './components/views/CheckView.jsx';
import { FaqView } from './components/views/FaqView.jsx';
import { Scenario } from './components/views/Scenario.jsx';
import { SettingsView } from './components/views/SettingsView.jsx';
import { DataManageSheet } from './components/sheets/DataManageSheet.jsx';
import { ExportOptionsSheet } from './components/sheets/ExportOptionsSheet.jsx';
import { DeleteConfirmSheet } from './components/sheets/DeleteConfirmSheet.jsx';
import { DeletePhotosOnlySheet } from './components/sheets/DeletePhotosOnlySheet.jsx';
import { AboutSheet } from './components/sheets/AboutSheet.jsx';
import { PrivacyInfoSheet } from './components/sheets/PrivacyInfoSheet.jsx';
import { MenuDropdown } from './components/sheets/MenuDropdown.jsx';
import { TripSheet } from './components/sheets/TripSheet.jsx';
import { TripEditSheet } from './components/sheets/TripEditSheet.jsx';
import { QuickAddFlow } from './components/sheets/QuickAddFlow.jsx';
import { EditSheet } from './components/sheets/EditSheet.jsx';
import { DetailSheet } from './components/sheets/DetailSheet.jsx';

export default function App() {
  const [loaded, setLoaded] = useState(false);
  const [items, setItems] = useState([]);
  const [photos, setPhotos] = useState({});
  const [settings, setSettings] = useState({
    rate: 0.21,
    rateAt: null,
    lang: 'zh',
    // 第一次要用相機/相簿前要先看過權限說明——這裡預設 false 也適用
    // 舊資料：舊使用者升級上來，settings 裡本來就沒有這個欄位，跟
    // 全新安裝一樣會先看過一次，不會因為是舊資料就被跳過。
    photoPermissionPrimed: false,
  });
  const [trips, setTrips] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [tripSheet, setTripSheet] = useState(false);
  const [editingTripId, setEditingTripId] = useState(null);
  const [endedSheetOpen, setEndedSheetOpen] = useState(false);
  const [deadline3dSheetOpen, setDeadline3dSheetOpen] = useState(false);
  const [refundCheckOpen, setRefundCheckOpen] = useState(false);
  // 匯出／刪除資料：58 資料管理／59 匯出選項／60 刪除確認／「只刪
  // 照片」四層各自獨立的開關，開哪一層就疊在哪一層上面，見下面的
  // useBackClose 註冊。exportOptions／deleteConfirm 帶 scope
  // （'trip' | 'endedTrips' | 'all'）決定這次動作的範圍。
  const [dataManageOpen, setDataManageOpen] = useState(false);
  const [exportOptions, setExportOptions] = useState(null);
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [deletePhotosOnlyOpen, setDeletePhotosOnlyOpen] = useState(false);
  // 關於 Kaeru／隱私說明：從設定頁、從關於頁裡的連結都能到隱私說明，
  // 兩層各自獨立開關，疊法跟上面匯出/刪除那組一樣。
  const [aboutOpen, setAboutOpen] = useState(false);
  const [privacyOpen, setPrivacyOpen] = useState(false);
  const [quickAddOn, setQuickAddOn] = useState(false);
  // 快路存完之後的「收據存好了」提示——見 quickSaveDraft。
  // { showDeparturePrompt } | null，departurePrompt 只在「這趟第一張
  // 收據、且還沒填回程時間」時是 true，只出現這一次。
  const [savedToast, setSavedToast] = useState(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [tab, setTab] = useState('home');
  const [editing, setEditing] = useState(null);
  const [openId, setOpenId] = useState(null);
  const [quizOn, setQuizOn] = useState(false);
  const [rateBusy, setRateBusy] = useState(false);
  const [rateErr, setRateErr] = useState(false);
  const [exitArmed, setExitArmed] = useState(false); // Android 離開提示條：按第一次返回鍵才會顯示
  const exitArmedRef = useRef(false);
  const exitTimerRef = useRef(null);

  const lang = settings.lang;
  const t = T[lang];

  // 五個主畫面同一層：不管在收據／查驗／FQA／設定互相怎麼切，返回鍵
  // 一次就回總覽，不會一層一層退之前切過的分頁。
  useBackClose(tab !== 'home', () => setTab('home'));
  useBackClose(tripSheet, () => setTripSheet(false));
  useBackClose(endedSheetOpen, () => setEndedSheetOpen(false));
  useBackClose(deadline3dSheetOpen, () => setDeadline3dSheetOpen(false));
  useBackClose(refundCheckOpen, () => setRefundCheckOpen(false));
  useBackClose(dataManageOpen, () => setDataManageOpen(false));
  useBackClose(!!exportOptions, () => setExportOptions(null));
  useBackClose(!!deleteConfirm, () => setDeleteConfirm(null));
  useBackClose(deletePhotosOnlyOpen, () => setDeletePhotosOnlyOpen(false));
  useBackClose(aboutOpen, () => setAboutOpen(false));
  useBackClose(privacyOpen, () => setPrivacyOpen(false));
  useBackClose(quickAddOn, () => setQuickAddOn(false));
  useBackClose(menuOpen, () => setMenuOpen(false));
  useBackClose(!!openId, () => setOpenId(null));
  useBackClose(quizOn, () => setQuizOn(false));
  // editing（新增/編輯收據）跟 editingTripId（編輯行程）都不在這裡
  // 註冊：EditSheet／TripEditSheet 自己用 useDirtyBackGuard 接返回，
  // 有未存的變動要先問，不能直接關掉。這裡如果重複註冊一次，等於
  // 同一層在堆疊裡算了兩次，返回一次會多退一層。

  function armExitHint() {
    exitArmedRef.current = true;
    setExitArmed(true);
    clearTimeout(exitTimerRef.current);
    exitTimerRef.current = setTimeout(() => {
      exitArmedRef.current = false;
      setExitArmed(false);
    }, 2000);
  }

  // Android 實體返回鍵：全部自己接管，不用系統預設行為（預設是
  // webView.goBack() 或直接關 App，兩個都不是我們要的）。有任何一層
  // sheet/面板開著（kaeruBackDepth > 0）就照 history 退一層；已經在
  // 最底層（總覽、沒有任何 sheet）才走雙擊退出流程。iOS 沒有這顆鍵，
  // 這個 listener 在 iOS 上不會被呼叫。用 ref 讀 exitArmed 是為了只
  // 訂閱一次，不用每次提示條開關都重新 addListener。
  useEffect(() => {
    let handle;
    CapacitorApp.addListener('backButton', () => {
      if (kaeruBackDepth > 0) {
        window.history.back();
        return;
      }
      if (exitArmedRef.current) {
        clearTimeout(exitTimerRef.current);
        exitArmedRef.current = false;
        setExitArmed(false);
        CapacitorApp.exitApp();
      } else {
        armExitHint();
      }
    }).then((h) => {
      handle = h;
    });
    return () => {
      handle && handle.remove();
    };
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const r = await window.storage.get(MAIN_KEY);
        if (r && r.value) {
          const parsed = JSON.parse(r.value);
          const list = parsed.items || [];
          const savedSettings = parsed.settings || {};
          let tripList = parsed.trips || [];
          let active = parsed.activeId || null;

          if (!tripList.length) {
            const id = genTripId();
            tripList = [
              { id, name: '', departure: savedSettings.departure || '' },
            ];
            active = id;
          }
          if (!active || !tripList.some((x) => x.id === active))
            active = tripList[0].id;

          const fallback = active;
          const migrated = list.map((it) =>
            it.tripId ? it : { ...it, tripId: fallback },
          );

          setTrips(tripList);
          setActiveId(active);
          setItems(migrated);
          delete savedSettings.departure;
          setSettings((s) => ({ ...s, ...savedSettings }));
          const map = {};
          for (const it of list.filter((i) => i.hasPhoto)) {
            try {
              const p = await window.storage.get(photoKey(it.id));
              if (p && p.value) {
                // 舊資料是單張 dataURL 字串，或字串陣列（最多 4 張）；
                // 更早之前存的可能連陣列都不是，是單一字串——三種形式
                // 都要收得住。normalizePhotoList 統一轉成 {src,type}，
                // 讀不出型別的（所有舊資料都是這樣）預設當 'receipt'。
                try {
                  const parsed = JSON.parse(p.value);
                  map[it.id] = normalizePhotoList(
                    Array.isArray(parsed) ? parsed : [p.value],
                  );
                } catch (e) {
                  map[it.id] = normalizePhotoList([p.value]);
                }
              }
            } catch (e) {}
          }
          setPhotos(map);
        }
      } catch (e) {}
      setLoaded(true);
    })();
  }, []);

  useEffect(() => {
    if (!loaded || trips.length) return;
    const id = genTripId();
    setTrips([{ id, name: '', departure: '' }]);
    setActiveId(id);
  }, [loaded, trips.length]);

  useEffect(() => {
    if (!loaded) return;
    window.storage
      .set(MAIN_KEY, JSON.stringify({ items, settings, trips, activeId }))
      .catch(() => {});
  }, [items, settings, trips, activeId, loaded]);

  const activeTrip = trips.find((x) => x.id === activeId) || null;
  const tripItems = useMemo(
    () => items.filter((it) => it.tripId === activeId),
    [items, activeId],
  );

  const groups = useMemo(() => {
    const m = new Map();
    for (const it of tripItems) {
      const k = groupKey(it);
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(it);
    }
    const out = new Map();
    for (const [k, arr] of m) {
      const net = arr.reduce((s, i) => s + netOfItem(i), 0);
      out.set(k, { arr, net, ok: net >= 5000 });
    }
    return out;
  }, [tripItems]);

  // 收據卡右下角要顯示「這張收據附了幾張物品照片」，但卡片本身完全不
  // 需要照片內容（base64 資料很大，列表卷動時每張卡都吃到會很浪費）——
  // 只算數量、不把整包 photos 傳下去，清單重新渲染時也不會被照片資料
  // 拖慢。
  const itemPhotoCounts = useMemo(() => {
    const m = {};
    for (const id of Object.keys(photos)) {
      const n = (photos[id] || []).filter((p) => p && p.type === 'item').length;
      if (n > 0) m[id] = n;
    }
    return m;
  }, [photos]);

  function taxOf(it) {
    // 這張收據理論上能退的稅額上限：含稅金額－稅抜金額。
    const naiveTax = (it.incl || 0) - netOfItem(it);
    if (
      it.taxOverride !== null &&
      it.taxOverride !== undefined &&
      it.taxOverride !== ''
    ) {
      // #12 修正：手動輸入的退稅金額原本沒有跟這個理論上限比對，打錯
      // 一個位數（例如多打一個 0）不會被擋下來，會直接算進可退稅總額、
      // 查驗頁總額等所有地方。夾在 [0, naiveTax] 之間。
      const override = Number(it.taxOverride) || 0;
      return Math.min(Math.max(0, override), naiveTax);
    }
    return naiveTax;
  }

  function deleteTrip(id) {
    const rest = trips.filter((x) => x.id !== id);
    items
      .filter((i) => i.tripId === id)
      .forEach((i) => {
        window.storage.delete(photoKey(i.id)).catch(() => {});
      });
    setPhotos((p) => {
      const n = { ...p };
      for (const i of items) if (i.tripId === id) delete n[i.id];
      return n;
    });
    setItems((prev) => prev.filter((i) => i.tripId !== id));
    setTrips(rest);
    if (activeId === id) setActiveId(rest.length ? rest[0].id : null);
  }

  // 刪除多趟行程（見資料管理「已結束的行程」）——跟 deleteTrip 同一套
  // 邏輯，一次處理多趟，不要一趟一趟呼叫 deleteTrip（那樣每趟都會各
  // 自觸發一次 setItems/setTrips，多趟時會閃過幾個中間狀態）。
  function deleteTrips(ids) {
    const idSet = new Set(ids);
    const affectedItems = items.filter((i) => idSet.has(i.tripId));
    affectedItems.forEach((i) => {
      window.storage.delete(photoKey(i.id)).catch(() => {});
    });
    setPhotos((p) => {
      const n = { ...p };
      affectedItems.forEach((i) => delete n[i.id]);
      return n;
    });
    setItems((prev) => prev.filter((i) => !idSet.has(i.tripId)));
    const rest = trips.filter((x) => !idSet.has(x.id));
    setTrips(rest);
    if (idSet.has(activeId)) setActiveId(rest.length ? rest[0].id : null);
  }

  // 只刪照片——留下金額/店名/日期這些記帳用得到的資料，只清照片本身
  // 跟對應的 storage key。hasPhoto 要一併改回 false：收據卡右下角的
  // 相機圖示、詳情頁的附件區都是看這個欄位決定要不要顯示，不清的話
  // 畫面會以為照片還在。
  function deleteAllPhotos() {
    items.forEach((it) => {
      window.storage.delete(photoKey(it.id)).catch(() => {});
    });
    setPhotos({});
    setItems((prev) => prev.map((it) => ({ ...it, hasPhoto: false })));
  }

  // 全部資料：連行程／機場設定一起清掉，回到「還沒有名字」的空狀態
  // ——只清 items/photos 會留下一堆空殼行程，跟使用者「從零開始」的
  // 期待不符。匯率/語言這些是 App 本身的偏好設定，不算「資料」，不
  // 在這個動作的範圍內，繼續保留。
  function deleteEverything() {
    items.forEach((it) => {
      window.storage.delete(photoKey(it.id)).catch(() => {});
    });
    setItems([]);
    setPhotos({});
    setTrips([]);
    setActiveId(null);
  }

  function tripStatsFor(id) {
    const list = items.filter((i) => i.tripId === id);
    let totalIncl = 0,
      pending = 0,
      refunded = 0,
      dead = 0;
    for (const it of list) {
      totalIncl += it.incl || 0;
      if (it.consumed) dead++;
      else if (it.status === 'refunded') refunded++;
      else pending++;
    }
    return { count: list.length, totalIncl, pending, refunded, dead };
  }

  // 期限「還剩幾天」概念上是從回程時間往回算的——沒有回程時間，這個
  // 數字對使用者沒有實際意義：90 天免稅期限是死的政府規則，但使用者
  // 真正要知道的是「我的班機起飛前趕不趕得上」，這件事離不開回程時間。
  // 沒有回程時間卻硬算出一個「還剩 87 天」，看起來篤定、其實只是巧合
  // 湊出來的數字（也許他 5 天後就要飛了），比誠實顯示「待定」更危險。
  // 見 CLAUDE_CODE_DELTA_未設定回程時間.md。
  const hasDeparture = !!activeTrip?.departure;
  const stats = useMemo(() => {
    let totalIncl = 0,
      refundable = 0,
      refundedTax = 0,
      pendingCount = 0,
      minDays = null,
      todoCount = 0,
      todoTax = 0;
    // ≤14 天到期警示：收集所有還沒失效、還沒退款、資料齊全的候選，最後
    // 挑最快到期的那張出來當代表（金額、店名），數量給的是整批的張數。
    const deadlineSoonList = [];
    for (const it of tripItems) {
      totalIncl += it.incl || 0;
      const g = groups.get(groupKey(it));
      // 資料待補（快速新增、OCR 沒讀到店名）跟已過期未退的收據，都不
      // 算進任何「還可以退/還沒處理」的主動追蹤範圍——前者金額可能是
      // OCR 誤讀，不能拿去算承諾；後者已經拿不回來了，算進去只會讓
      // 使用者以為還有機會。兩者都不刪除、不隱藏，只是不進這裡的加總。
      const pendingInfo = isPendingInfo(it);
      const expired = isExpiredUnclaimed(it);
      const eligible = g && g.ok && !it.consumed && !pendingInfo && !expired;
      if (eligible && it.status !== 'refunded') refundable += taxOf(it);
      // #10 修正：原本只算 status==='refunded'——「已查驗」（在機場查驗
      // 過、只是還沒手動標成「已退款」）的金額既不算進 refundable 之後
      // 的顯示（行程「已出境」後首頁改看 refundedTax），也不算進這裡，
      // 憑空從畫面上消失。查驗過就當作錢已經到手。
      // 注意：verified 的收據會同時被算進上面的 refundable——這不是
      // 沒扣乾淨，是故意的：refundable／refundedTax 不是「互斥的兩個
      // 集合」，是同一批收據在「出境前」跟「出境後」兩個時間點各自
      // 該顯示的數字（首頁用 departed 決定顯示哪一個，見 3410/3417 附
      // 近），兩個都要包含 verified，只是從來不會同時加總在一起顯示。
      if (eligible && (it.status === 'verified' || it.status === 'refunded'))
        refundedTax += taxOf(it);
      // 已在境內吃掉/用掉的收據退不了稅，不算「還沒處理」，跟
      // tripStatsFor 的 pending 判斷一致，不然首頁「還沒處理」的張數
      // 跟最近到期倒數，會把已經失效、退不了稅的收據也算進去。
      if (it.status !== 'refunded' && !it.consumed && !pendingInfo && !expired) {
        pendingCount++;
        const d = hasDeparture ? daysLeft(it.date) : null;
        if (d !== null && (minDays === null || d < minDays)) minDays = d;
        if (d !== null && d >= 0 && d <= 14) deadlineSoonList.push({ it, d });
      }
      // 回程當天行動列（首頁）用的「今天要辦的事」，跟查驗頁的 todo
      // 是同一份定義：已達標、沒消費、沒過期、資料補齊，但還沒在機場
      // 查驗過的收據。
      if (eligible && (it.status === 'purchased' || it.status === 'registered')) {
        todoCount++;
        todoTax += taxOf(it);
      }
    }
    deadlineSoonList.sort((a, b) => a.d - b.d);
    const deadlineSoon = deadlineSoonList.length
      ? {
          count: deadlineSoonList.length,
          days: deadlineSoonList[0].d,
          amount: taxOf(deadlineSoonList[0].it),
          shop: deadlineSoonList[0].it.shop,
        }
      : null;
    return {
      totalIncl,
      refundable,
      refundedTax,
      pendingCount,
      minDays,
      todoCount,
      todoTax,
      deadlineSoon,
    };
  }, [tripItems, groups, hasDeparture]);

  // 保守偵測「這趟結束了」：回程時間超過 24 小時，且這趟的收據全部
  // 已退款或已失效（沒有任何一張還卡在待處理），才會跳一次提示。
  // 沒有收據的行程永遠不會跳；跳過一次之後就在 trip 上記一個旗標，
  // 這趟再也不會自動跳出來——一律等使用者自己按。
  const activeTripStats = activeTrip ? tripStatsFor(activeTrip.id) : null;
  const shouldPromptEnded =
    !!activeTrip &&
    !!activeTrip.departure &&
    !activeTrip.endedPromptShown &&
    !!activeTripStats &&
    activeTripStats.count > 0 &&
    activeTripStats.pending === 0 &&
    Date.now() - new Date(activeTrip.departure).getTime() > 24 * 3600 * 1000;

  useEffect(() => {
    if (!shouldPromptEnded) return;
    const id = activeTrip.id;
    setEndedSheetOpen(true);
    setTrips((prev) =>
      prev.map((x) => (x.id === id ? { ...x, endedPromptShown: true } : x)),
    );
    // 依賴要連 activeTrip?.id 一起看——只看 shouldPromptEnded 這個布林值
    // 的話，切到另一趟「同時也符合條件、還沒跳過」的行程時，React 看到
    // true → true 沒有變化，不會重新執行這個 effect，新行程的提示永遠
    // 跳不出來。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shouldPromptEnded, activeTrip?.id]);

  // ≤3 天期限警示：只提一次，不是每天都跳。這個 app 目前沒有真的 OS
  // 推播（沒有裝 local-notifications 之類的原生套件、也沒有跟使用者
  // 要通知權限），所以做成「打開 App 時如果符合條件就跳一次」的站內
  // 提示，跟「這趟結束了」用同一種一次性旗標機制。
  const shouldPromptDeadline3d =
    !!activeTrip &&
    !activeTrip.deadline3dPromptShown &&
    !!stats.deadlineSoon &&
    stats.deadlineSoon.days <= 3;

  useEffect(() => {
    if (!shouldPromptDeadline3d) return;
    const id = activeTrip.id;
    setDeadline3dSheetOpen(true);
    setTrips((prev) =>
      prev.map((x) => (x.id === id ? { ...x, deadline3dPromptShown: true } : x)),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shouldPromptDeadline3d, activeTrip?.id]);

  // 退款確認：回程後 7 天問一次「錢進來了嗎」，不要求使用者每天回來記
  // 帳。跟上面兩個一樣是站內提示（沒有真的推播），但這裡故意可以重複
  // 出現——使用者可以按「7 天後再提醒我一次」，把下一次提醒時間往後推。
  const refundCheckEligibleCount = tripItems.filter(
    (it) =>
      !it.consumed &&
      !isPendingInfo(it) &&
      (it.status === 'verified' || it.status === 'refunded'),
  ).length;
  const shouldPromptRefundCheck =
    !!activeTrip &&
    !!activeTrip.departure &&
    !activeTrip.refundCheckDismissed &&
    refundCheckEligibleCount > 0 &&
    (activeTrip.refundCheckNextAt
      ? Date.now() >= new Date(activeTrip.refundCheckNextAt).getTime()
      : Date.now() - new Date(activeTrip.departure).getTime() >= 7 * 86400000);

  useEffect(() => {
    if (!shouldPromptRefundCheck) return;
    setRefundCheckOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shouldPromptRefundCheck, activeTrip?.id]);

  function upsert(input, photosData) {
    const item = { ...input, tripId: input.tripId || activeId };
    setItems((prev) =>
      prev.some((p) => p.id === item.id)
        ? prev.map((p) => (p.id === item.id ? item : p))
        : [item, ...prev],
    );
    if (photosData !== undefined) {
      if (photosData && photosData.length) {
        setPhotos((p) => ({ ...p, [item.id]: photosData }));
        window.storage
          .set(photoKey(item.id), JSON.stringify(photosData))
          .catch(() => {});
      } else {
        setPhotos((p) => {
          const n = { ...p };
          delete n[item.id];
          return n;
        });
        window.storage.delete(photoKey(item.id)).catch(() => {});
      }
    }
  }

  function remove(id) {
    setItems((prev) => prev.filter((p) => p.id !== id));
    setPhotos((p) => {
      const n = { ...p };
      delete n[id];
      return n;
    });
    window.storage.delete(photoKey(id)).catch(() => {});
    setOpenId(null);
  }

  // 「+」統一先走快路（拍照優先）。完整表單還在，只是不再是預設路徑——
  // 快路裡的「現在就填完整資料」跟編輯既有收據都還是走 setEditing。
  function startAdd() {
    setQuickAddOn(true);
  }

  // 快路「存起來，晚點再補」：跟 EditSheet.save() 走的是同一套狀態機
  // 推導（有登記才進 registered，否則停在 purchased），只是欄位少很多、
  // 沒有使用者手動調過的 taxOverride/note/unpacked/consumed。
  function quickSaveDraft(draft, photosArr) {
    const id = `r_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    // 「這是這趟的第一張收據」要在存檔前判斷——upsert 一執行，
    // tripItems 馬上就會多一筆，存檔後再檢查永遠會看到「至少有一張」。
    const wasFirstItem = tripItems.length === 0;
    upsert(
      {
        id,
        shop: draft.shop,
        date: draft.date,
        incl: draft.incl,
        rate: draft.rate,
        incl8: draft.incl8,
        incl10: draft.incl10,
        taxOverride: null,
        refundMethod: draft.refundMethod,
        unpacked: false,
        consumed: false,
        note: '',
        status: draft.refundMethod === 'registered' ? 'registered' : 'purchased',
        hasPhoto: !!photosArr.length,
        tripId: activeId,
      },
      photosArr,
    );
    setQuickAddOn(false);
    // 只有第一張、且回程時間還沒填的時候才加問回程時間那一段，而且
    // 這個條件天生只會在「這趟的第一張」成立一次，不需要另外存一個
    // 「已經問過」的旗標——第二張存的時候 wasFirstItem 已經是 false。
    // 店裡不是填航班的場合，這句只問一次，關掉／選了動作就不再問，
    // 總覽上方的缺口會一直留著提醒。
    setSavedToast({
      showDeparturePrompt: wasFirstItem && !activeTrip?.departure,
    });
  }

  // 沒有回程時間那一段的 toast 帶了兩顆需要使用者讀完、選一個的按鈕，
  // 不能自動關掉；一般的存檔確認（第二張以後、或回程時間本來就填好）
  // 只是單純的成功回饋，看過就好，自動收掉，不用逼使用者手動關。
  useEffect(() => {
    if (!savedToast || savedToast.showDeparturePrompt) return;
    const timer = setTimeout(() => setSavedToast(null), 2600);
    return () => clearTimeout(timer);
  }, [savedToast]);

  // toast 的「設定」按鈕自己會關掉 toast 再開編輯行程，但使用者不一定
  // 從那顆按鈕進去——可能是點行程名稱、切到設定分頁、或任何其他路徑
  // 到達編輯行程／別的畫面。toast 是「固定在畫面最上層」的浮動元件，
  // 不會因為底下開了別的 sheet 就自己消失，沒特別處理的話，會像貼紙
  // 一樣一路疊在新畫面上面，看起來像「怎麼還在」。這裡讓它在使用者
  // 離開首頁去做任何別的事情時，一併收掉——這個提示本來就只對應
  // 「剛存檔那一刻」，沒有必要跟著使用者到處飄。
  useEffect(() => {
    if (
      editingTripId !== null ||
      quickAddOn ||
      openId !== null ||
      tab !== 'home' ||
      tripSheet ||
      menuOpen ||
      endedSheetOpen ||
      deadline3dSheetOpen ||
      refundCheckOpen ||
      dataManageOpen
    ) {
      setSavedToast(null);
    }
  }, [
    editingTripId,
    quickAddOn,
    openId,
    tab,
    tripSheet,
    menuOpen,
    endedSheetOpen,
    deadline3dSheetOpen,
    refundCheckOpen,
    dataManageOpen,
  ]);

  async function fetchRate() {
    setRateBusy(true);
    setRateErr(false);
    try {
      const res = await fetch('https://open.er-api.com/v6/latest/JPY');
      const d = await res.json();
      const v = d && d.rates && d.rates.TWD;
      if (!v) throw new Error('no rate');
      setSettings((s) => ({
        ...s,
        rate: Number(v.toFixed(4)),
        rateAt: new Date().toISOString(),
      }));
    } catch (e) {
      setRateErr(true);
    }
    setRateBusy(false);
  }

  if (!loaded) {
    return (
      <div
        className="flex min-h-screen items-center justify-center"
        style={{ backgroundColor: C.bg, color: C.sub, fontFamily: FONT }}
      >
        {T.zh.loading}
      </div>
    );
  }

  const openItem = items.find((i) => i.id === openId);

  return (
    <div
      style={{
        minHeight: '100dvh',
        overflowX: 'hidden',
        backgroundColor: C.bg,
        color: C.ink,
        fontFamily: FONT,
        letterSpacing: '0.01em',
        WebkitFontSmoothing: 'antialiased',
      }}
    >
      <style>{`.jp-underline:focus{border-color:${C.ink} !important}
        input[type=number]::-webkit-outer-spin-button,input[type=number]::-webkit-inner-spin-button{-webkit-appearance:none;margin:0}
        input[type=number]{-moz-appearance:textfield}
        /* RWD：單欄置中，320–480 隨欄寬，480 以上鎖寬只加留白，<390 整體等比縮放。
           縮放本來用 CSS 的 zoom 屬性做，但 zoom 是非標準屬性，不同廠牌手機的
           WebView 支援程度不一致——實測某支 Android 手機完全沒套用 zoom，
           畫面照 390px 版面整個畫出來，超出螢幕的部分被直接裁掉，不是等比縮小。
           改用所有瀏覽器都支援的 transform:scale。transform 不會讓元素本身
           在版面裡佔用的空間跟著縮小（跟 zoom 不一樣），所以要手動補償：
           - overflow-x:hidden 擋掉右側因為版面沒縮小而多出來的水平捲動空間
           - margin-bottom 用負值把「視覺縮小後」跟「版面裡實際佔用高度」的
             差額拉掉，不然畫面下面會留一截可以往下捲、卻是空的區域 */
        @media (max-width:389.98px){
          html,body{overflow-x:hidden}
          .kaeru-app{
            --k-scale:calc(100vw / 390px);
            width:390px;
            transform-origin:top left;
            transform:scale(var(--k-scale));
            margin-bottom:calc(-100dvh * (1 - var(--k-scale)));
          }
        }
        .kaeru-pad{padding-left:26px;padding-right:26px}
        @media (min-width:480px){.kaeru-pad{padding-left:30px;padding-right:30px}}
        .kaeru-bignum{font-size:48px}
        @media (min-width:480px){.kaeru-bignum{font-size:52px}}
        .kaeru-refund{font-size:42px}
        @media (min-width:480px){.kaeru-refund{font-size:46px}}
        .kaeru-group-gap{display:flex;flex-direction:column;gap:18px}
        @media (min-width:480px){.kaeru-group-gap{gap:22px}}
        /* web 版隱藏捲軸，但保留可滑動——外境機場選擇頁的籌碼列／清單用 */
        .no-scrollbar{scrollbar-width:none;-ms-overflow-style:none}
        .no-scrollbar::-webkit-scrollbar{display:none}`}</style>
      <div
        className="kaeru-app"
        style={{
          backgroundColor: C.page,
          opacity: tripSheet || endedSheetOpen ? 0.35 : 1,
          transition: 'opacity 200ms',
        }}
      >
        {!(tab === 'faq' && quizOn) && (
          <header
            className="kaeru-pad sticky top-0 z-30 pb-3"
            style={{
              backgroundColor: C.page,
              borderBottom: `1px solid ${C.line}`,
              paddingTop: 'max(14px, env(safe-area-inset-top))',
            }}
          >
            <div className="flex items-end justify-between">
              {tab === 'home' ? (
                <div className="flex items-center gap-2.5">
                  <FrogMark size={26} />
                  <div>
                    <h1
                      className="font-semibold"
                      style={{
                        color: C.blueDeep,
                        fontSize: '12.5px',
                        letterSpacing: '0.28em',
                        textTransform: 'uppercase',
                      }}
                    >
                      {t.appName}
                    </h1>
                    <button
                      onClick={() => setTripSheet(true)}
                      className="mt-0.5 flex items-center gap-1 text-xs"
                      style={{ color: C.sub }}
                    >
                      {activeTrip
                        ? activeTrip.name || t.tripUnnamed
                        : t.trips}
                      <ChevronRight size={12} />
                    </button>
                  </div>
                </div>
              ) : (
                <h1
                  className="font-bold"
                  style={{ fontSize: '20px', color: C.ink }}
                >
                  {
                    {
                      list: t.receipts,
                      check: t.checkTitle,
                      faq: t.faqTitle,
                      set: t.settings,
                    }[tab]
                  }
                </h1>
              )}
              <div className="relative flex items-center gap-0.5">
                <button
                  onClick={startAdd}
                  className="rounded-lg p-2"
                  style={{ color: C.ink }}
                  aria-label={t.menuAdd}
                >
                  <Plus size={20} />
                </button>

                <button
                  onClick={() => {
                    setTab('list');
                    setQuizOn(false);
                  }}
                  className="rounded-lg p-2"
                  style={{ color: tab === 'list' ? C.blue : C.ink }}
                  aria-label={t.nav.list}
                >
                  <Rows3 size={19} strokeWidth={tab === 'list' ? 2.2 : 1.8} />
                </button>

                <span
                  className="mx-1 h-4 w-px"
                  style={{ backgroundColor: C.line }}
                />

                <button
                  onClick={() => setMenuOpen((v) => !v)}
                  className="rounded-lg p-2"
                  style={{ color: menuOpen ? C.blue : C.ink }}
                  aria-label={t.menu}
                >
                  {menuOpen ? <X size={20} /> : <Menu size={20} />}
                </button>

                {menuOpen && (
                  <MenuDropdown
                    t={t}
                    lang={lang}
                    tab={tab}
                    trip={activeTrip}
                    onClose={() => setMenuOpen(false)}
                    onGo={(k) => {
                      setMenuOpen(false);
                      deferOpen(() => {
                        setTab(k);
                        setQuizOn(false);
                      });
                    }}
                    onAdd={() => {
                      setMenuOpen(false);
                      deferOpen(startAdd);
                    }}
                    onTrips={() => {
                      setMenuOpen(false);
                      deferOpen(() => setTripSheet(true));
                    }}
                    onLang={() =>
                      setSettings((s) => ({
                        ...s,
                        lang: s.lang === 'zh' ? 'ja' : 'zh',
                      }))
                    }
                  />
                )}
              </div>
            </div>
          </header>
        )}

        <main className="flex-1 kaeru-pad py-4">
          {tab === 'home' && (
            <HomeView
              t={t}
              stats={stats}
              settings={settings}
              trip={activeTrip}
              hasItems={tripItems.length > 0}
              itemCount={tripItems.length}
              onAdd={startAdd}
              onGoSettings={() => setTab('set')}
              onGoList={() => setTab('list')}
              onGoCheck={() => setTab('check')}
              onEditTrip={() => setEditingTripId(activeId)}
              onGoFaq={() => {
                setTab('faq');
                setQuizOn(false);
              }}
              onStartSim={() => {
                setTab('faq');
                setQuizOn(true);
              }}
            />
          )}

          {tab === 'list' && (
            <ListView
              t={t}
              items={tripItems}
              groups={groups}
              taxOf={taxOf}
              settings={settings}
              itemPhotoCounts={itemPhotoCounts}
              hasDeparture={hasDeparture}
              onEditTrip={() => setEditingTripId(activeId)}
              onOpen={setOpenId}
              onAdd={startAdd}
            />
          )}

          {tab === 'check' && (
            <CheckView
              t={t}
              items={tripItems}
              groups={groups}
              taxOf={taxOf}
              onVerifyOne={(id) =>
                setItems((prev) =>
                  prev.map((p) =>
                    p.id === id ? { ...p, status: 'verified' } : p,
                  ),
                )
              }
              onVerifyAll={() =>
                setItems((prev) =>
                  prev.map((it) => {
                    if (it.tripId !== activeId) return it;
                    const g = groups.get(groupKey(it));
                    const eligible =
                      g &&
                      g.ok &&
                      !it.consumed &&
                      !isPendingInfo(it) &&
                      !isExpiredUnclaimed(it);
                    return eligible &&
                      (it.status === 'purchased' || it.status === 'registered')
                      ? { ...it, status: 'verified' }
                      : it;
                  }),
                )
              }
            />
          )}

          {tab === 'faq' &&
            (quizOn ? (
              <Scenario t={t} lang={lang} onExit={() => setQuizOn(false)} />
            ) : (
              <FaqView t={t} lang={lang} onStart={() => setQuizOn(true)} />
            ))}

          {tab === 'set' && (
            <SettingsView
              t={t}
              settings={settings}
              setSettings={setSettings}
              trip={activeTrip}
              count={tripItems.length}
              onEditTrip={() => setEditingTripId(activeId)}
              onFetchRate={fetchRate}
              rateBusy={rateBusy}
              rateErr={rateErr}
              onOpenDataManage={() => setDataManageOpen(true)}
              onOpenAbout={() => setAboutOpen(true)}
            />
          )}
        </main>
      </div>

      {exitArmed && Capacitor.getPlatform() === 'android' && (
        <div
          className="fixed inset-0 z-50"
          style={{ pointerEvents: 'none' }}
        >
          <div className="relative kaeru-app" style={{ minHeight: 0, height: '100%' }}>
            <div
              className="absolute"
              style={{
                left: '26px',
                right: '26px',
                bottom: 'max(34px, calc(env(safe-area-inset-bottom) + 14px))',
                backgroundColor: C.ink,
                padding: '14px 16px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: '14px',
                pointerEvents: 'auto',
              }}
            >
              <div>
                <div style={{ fontSize: '13px', fontWeight: 600, color: '#FFFFFF' }}>
                  {t.exitPressAgain}
                </div>
                <div
                  className="mt-0.5"
                  style={{ fontSize: '11px', color: 'rgba(255,255,255,0.7)' }}
                >
                  {t.exitDataSafe}
                </div>
              </div>
              <button
                onClick={() => {
                  clearTimeout(exitTimerRef.current);
                  exitArmedRef.current = false;
                  setExitArmed(false);
                }}
                style={{ fontSize: '11.5px', fontWeight: 700, color: C.sage, flexShrink: 0 }}
              >
                {t.exitStay}
              </button>
            </div>
          </div>
        </div>
      )}

      {savedToast && (
        <div className="fixed inset-0 z-50" style={{ pointerEvents: 'none' }}>
          <div className="relative kaeru-app" style={{ minHeight: 0, height: '100%' }}>
            <div
              className="absolute"
              style={{
                left: '22px',
                right: '22px',
                bottom: 'max(30px, calc(env(safe-area-inset-bottom) + 14px))',
                backgroundColor: C.ink,
                padding: '15px 17px',
                borderRadius: 0,
                pointerEvents: 'auto',
              }}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2">
                  {/* 深底變體：一般打勾用的 C.sage 在這個深色底上對比不
                      夠，這裡换成專門給深底用的較亮色調。 */}
                  <CheckCircle2 size={17} style={{ color: '#B8CBB7' }} />
                  <span style={{ fontSize: '13.5px', fontWeight: 700, color: '#FFFFFF' }}>
                    {t.savedToastTitle}
                  </span>
                </div>
                {savedToast.showDeparturePrompt && (
                  <button onClick={() => setSavedToast(null)}>
                    <X size={16} style={{ color: 'rgba(255,255,255,0.5)' }} />
                  </button>
                )}
              </div>
              {savedToast.showDeparturePrompt && (
                <>
                  <p
                    className="mt-2"
                    style={{ fontSize: '12.5px', color: 'rgba(255,255,255,0.78)', lineHeight: 1.6 }}
                  >
                    {t.savedToastDeparturePrompt}
                  </p>
                  <div className="mt-3 flex gap-2">
                    <button
                      onClick={() => {
                        setSavedToast(null);
                        setEditingTripId(activeId);
                      }}
                      className="flex-1 py-2.5 text-sm font-bold"
                      style={{ backgroundColor: '#FFFFFF', color: C.ink }}
                    >
                      {t.setDepartureCta}
                    </button>
                    <button
                      onClick={() => {
                        setSavedToast(null);
                        setQuickAddOn(true);
                      }}
                      className="flex-1 py-2.5 text-sm font-semibold"
                      style={{ border: '1px solid rgba(255,255,255,0.28)', color: '#FFFFFF' }}
                    >
                      {t.retakeOneMoreCta}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {tripSheet && (
        <TripSheet
          t={t}
          trips={trips}
          activeId={activeId}
          items={items}
          onClose={() => setTripSheet(false)}
          onSelect={(id) => {
            setActiveId(id);
            setTripSheet(false);
          }}
          onCreate={(name, departure) => {
            const id = genTripId();
            setTrips((prev) => [...prev, { id, name, departure }]);
            setActiveId(id);
            setTripSheet(false);
          }}
          onDelete={deleteTrip}
          onEditTrip={(id) => setEditingTripId(id)}
        />
      )}

      {endedSheetOpen && activeTrip && activeTripStats && (
        <TripEndedSheet
          t={t}
          trip={activeTrip}
          tripStats={activeTripStats}
          refundedTax={stats.refundedTax}
          daysSince={Math.floor(
            (Date.now() - new Date(activeTrip.departure).getTime()) /
              86400000,
          )}
          onClose={() => setEndedSheetOpen(false)}
          onCreateNew={() => {
            setEndedSheetOpen(false);
            deferOpen(() => setTripSheet(true));
          }}
          onViewRecords={() => {
            setEndedSheetOpen(false);
            deferOpen(() => setTab('list'));
          }}
        />
      )}

      {deadline3dSheetOpen && stats.deadlineSoon && (
        <DeadlineWarnSheet
          t={t}
          deadlineSoon={stats.deadlineSoon}
          onClose={() => setDeadline3dSheetOpen(false)}
          onGoCheck={() => {
            setDeadline3dSheetOpen(false);
            deferOpen(() => setTab('check'));
          }}
        />
      )}

      {refundCheckOpen && activeTrip && (
        <RefundCheckSheet
          t={t}
          trip={activeTrip}
          items={tripItems.filter(
            (it) =>
              !it.consumed &&
              !isPendingInfo(it) &&
              (it.status === 'verified' || it.status === 'refunded'),
          )}
          taxOf={taxOf}
          daysSince={Math.floor(
            (Date.now() - new Date(activeTrip.departure).getTime()) / 86400000,
          )}
          onToggleStatus={(id, isRefunded) =>
            setItems((prev) =>
              prev.map((p) =>
                p.id === id
                  ? { ...p, status: isRefunded ? 'verified' : 'refunded' }
                  : p,
              ),
            )
          }
          onClose={() => setRefundCheckOpen(false)}
          onAllIn={() => {
            const id = activeTrip.id;
            setItems((prev) =>
              prev.map((p) =>
                p.tripId === id && p.status === 'verified'
                  ? { ...p, status: 'refunded' }
                  : p,
              ),
            );
            setTrips((prev) =>
              prev.map((x) =>
                x.id === id ? { ...x, refundCheckDismissed: true } : x,
              ),
            );
            setRefundCheckOpen(false);
          }}
          onRemindLater={() => {
            const id = activeTrip.id;
            setTrips((prev) =>
              prev.map((x) =>
                x.id === id
                  ? {
                      ...x,
                      refundCheckNextAt: new Date(
                        Date.now() + 7 * 86400000,
                      ).toISOString(),
                    }
                  : x,
              ),
            );
            setRefundCheckOpen(false);
          }}
        />
      )}

      {dataManageOpen && (
        <DataManageSheet
          t={t}
          items={items}
          trips={trips}
          photos={photos}
          activeTripId={activeId}
          onClose={() => setDataManageOpen(false)}
          onOpenExport={(scope) => setExportOptions(scope)}
          onOpenDeleteEnded={() => setDeleteConfirm({ kind: 'endedTrips' })}
          onOpenDeletePhotosOnly={() => setDeletePhotosOnlyOpen(true)}
          onOpenDeleteAll={() => setDeleteConfirm({ kind: 'all' })}
        />
      )}

      {exportOptions && (
        <ExportOptionsSheet
          t={t}
          lang={lang}
          scope={exportOptions}
          items={items}
          trips={trips}
          photos={photos}
          onClose={() => setExportOptions(null)}
          onExported={() => {
            setSettings((s) => ({ ...s, lastExportedAt: new Date().toISOString() }));
            setExportOptions(null);
          }}
        />
      )}

      {deleteConfirm && (
        <DeleteConfirmSheet
          t={t}
          scope={deleteConfirm}
          items={items}
          trips={trips}
          photos={photos}
          lastExportedAt={settings.lastExportedAt}
          onClose={() => setDeleteConfirm(null)}
          onExportFirst={() => {
            // 先匯出：不管這次是刪「已結束的行程」還是「全部資料」，
            // 一律匯出全部行程——匯出選項目前只有「這趟行程」／「全部
            // 行程」兩種範圍，沒有「只匯已結束的行程」這個選項，這裡
            // 寧可讓使用者多存一份用不到的資料，也不要少存到之後刪掉
            // 就再也拿不回來的東西。不關掉刪除確認——使用者匯出完通常
            // 還是想繼續刪，讓他能直接回來按刪除。
            setExportOptions({ kind: 'all' });
          }}
          onConfirmDelete={(scope) => {
            if (scope.kind === 'endedTrips') {
              deleteTrips(trips.filter(isTripEnded).map((x) => x.id));
            } else {
              deleteEverything();
            }
            setDeleteConfirm(null);
            setDataManageOpen(false);
          }}
        />
      )}

      {deletePhotosOnlyOpen && (
        <DeletePhotosOnlySheet
          t={t}
          photoBytes={photoStatsFrom(collectAllPhotos(items, photos)).bytes}
          onClose={() => setDeletePhotosOnlyOpen(false)}
          onConfirm={() => {
            deleteAllPhotos();
            setDeletePhotosOnlyOpen(false);
          }}
        />
      )}

      {aboutOpen && (
        <AboutSheet
          t={t}
          onClose={() => setAboutOpen(false)}
          onOpenPrivacy={() => setPrivacyOpen(true)}
        />
      )}

      {privacyOpen && (
        <PrivacyInfoSheet
          t={t}
          onClose={() => setPrivacyOpen(false)}
          onOpenDataManage={() => {
            setPrivacyOpen(false);
            setAboutOpen(false);
            setDataManageOpen(true);
          }}
        />
      )}

      {editingTripId && (
        <TripEditSheet
          t={t}
          trip={trips.find((x) => x.id === editingTripId)}
          isActive={editingTripId === activeId}
          tripStats={tripStatsFor(editingTripId)}
          tripCount={trips.length}
          onClose={() => setEditingTripId(null)}
          onSave={(patch, makeActive) => {
            setTrips((prev) =>
              prev.map((x) => (x.id === editingTripId ? { ...x, ...patch } : x)),
            );
            if (makeActive) setActiveId(editingTripId);
            setEditingTripId(null);
          }}
          onDelete={() => {
            deleteTrip(editingTripId);
            setEditingTripId(null);
          }}
        />
      )}

      {quickAddOn && (
        <QuickAddFlow
          t={t}
          onClose={() => setQuickAddOn(false)}
          onSaveQuick={quickSaveDraft}
          onSaveFull={(draft, photosArr) => {
            setQuickAddOn(false);
            // 快路存的草稿還沒真的存進 items/photos，用 _photos 這個
            // 一次性欄位把照片直接帶給 EditSheet 當初始值，跟真正存過
            // 的收據（有 id、photos[id] 找得到）分開處理，存檔之後
            // save() 會另外產生一個真的 id，這個草稿物件不會留下來。
            deferOpen(() => setEditing({ ...draft, _photos: photosArr }));
          }}
          photoPermissionPrimed={settings.photoPermissionPrimed}
          onPhotoPermissionPrimed={() =>
            setSettings((s) => ({ ...s, photoPermissionPrimed: true }))
          }
        />
      )}

      {editing && (
        <EditSheet
          t={t}
          initial={editing === 'new' ? null : editing}
          photos={
            editing === 'new'
              ? []
              : editing._photos || photos[editing.id] || []
          }
          onClose={() => setEditing(null)}
          onSave={(item, photosData) => {
            upsert(item, photosData);
            setEditing(null);
          }}
          photoPermissionPrimed={settings.photoPermissionPrimed}
          onPhotoPermissionPrimed={() =>
            setSettings((s) => ({ ...s, photoPermissionPrimed: true }))
          }
        />
      )}

      {openItem && (
        <DetailSheet
          t={t}
          item={openItem}
          group={groups.get(groupKey(openItem))}
          photos={photos[openItem.id] || []}
          onPhotosChange={(next) => upsert(openItem, next)}
          taxOf={taxOf}
          settings={settings}
          hasDeparture={hasDeparture}
          onClose={() => setOpenId(null)}
          onEdit={(it) => {
            setOpenId(null);
            deferOpen(() => setEditing(it));
          }}
          onStatus={(st) =>
            setItems((prev) =>
              prev.map((p) => (p.id === openId ? { ...p, status: st } : p)),
            )
          }
          onDelete={() => remove(openId)}
          onPhotoPermissionPrimed={() =>
            setSettings((s) => ({ ...s, photoPermissionPrimed: true }))
          }
        />
      )}
    </div>
  );
}
