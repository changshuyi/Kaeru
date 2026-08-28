import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Home,
  Rows3,
  ScanLine,
  HelpCircle,
  Settings as Cog,
  Plus,
  X,
  Trash2,
  ChevronRight,
  ChevronLeft,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Globe,
  RefreshCw,
  ArrowLeft,
  Menu,
  Calendar as CalIcon,
  MapPin,
  Image as ImageIcon,
  Camera as CameraIcon,
} from 'lucide-react';
import { Capacitor } from '@capacitor/core';
import { App as CapacitorApp } from '@capacitor/app';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import { Share } from '@capacitor/share';
import { Filesystem, Directory } from '@capacitor/filesystem';
import ReceiptScanner from './receiptScanner.js';
import {
  photoKey,
  dataUrlBytes,
  formatBytes,
  normalizePhotoList,
  isTripEnded,
  buildCsv,
  buildZip,
  estimateZipBytes,
  collectAllPhotos,
  photoStatsFrom,
} from './exportData.js';

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
let kaeruBackDepth = 0;
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

function useBackClose(isOpen, onClose) {
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
function useDirtyBackGuard(isDirty, onClose) {
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

// 「這筆還沒存，要放棄嗎？」的確認面板，三個表單共用一份文字跟樣式。
function DiscardConfirmSheet({ t, onKeepEditing, onDiscard }) {
  return (
    <BottomSheet onClose={onKeepEditing}>
      <p className="font-bold" style={{ fontSize: '15px', color: C.ink }}>
        {t.discardTitle}
      </p>
      <div className="mt-4 flex gap-2">
        <button
          onClick={onKeepEditing}
          className="flex-1 py-3 text-sm font-semibold"
          style={{ border: `1px solid ${C.line}`, color: C.ink }}
        >
          {t.keepEditing}
        </button>
        <button
          onClick={onDiscard}
          className="flex-1 py-3 text-sm font-bold"
          style={{ backgroundColor: C.clay, color: '#FFFFFF' }}
        >
          {t.discard}
        </button>
      </div>
    </BottomSheet>
  );
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
function deferOpen(fn) {
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

/* ------------------------------------------------------------------
   Kaeru　日本退稅小幫手 / 免税リファンドヘルパー
   規則依據：観光庁 消費税免税店サイト（2026/11/1 リファンド方式）
   - 同一店舗・同一日・税抜合計 5,000 円以上
   - 税関確認は「1 回の購入手続（レシート）」単位
   - 特殊包装は廃止。開封は問題なし。国内で「消費」した場合のみ返金不可
   - 購入日から 90 日以内・手荷物を預ける前に手続
------------------------------------------------------------------ */

const MAIN_KEY = 'jptax:v2';
const STAGES = ['purchased', 'registered', 'verified', 'refunded'];
const MAX_PHOTOS = 4; // 一張收據最多存幾張照片

// 這兩個故意手動維護，不用 new Date() 算——如果用「現在」算，畫面
// 會永遠顯示「今天」，變成每次打開 App 都謊稱隱私政策剛剛更新過。
// 版本號跟隱私政策內容實際變動時才手動改這裡，跟 App Store／Play
// 上架版本號、上面第 8 節寫的「政策的更新」原則一致。
const APP_VERSION_DATE = '2026 年 8 月';
const PRIVACY_UPDATED_AT = '2026-08';

function utf8ToBase64(str) {
  return btoa(unescape(encodeURIComponent(str)));
}
function uint8ToBase64(bytes) {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

// 匯出檔案存好之後要「開啟系統的分享選單」——原生殼裡先寫進 Cache
// 目錄（用完即丟，不需要使用者自己管理），再交給 Share plugin 開
// 分享選單；純網頁（開發時的 vite dev server）沒有這兩個 plugin 的
// 完整實作，退回用 <a download> 直接觸發瀏覽器下載，一樣能拿到檔案，
// 只是少了分享選單那一步。
async function shareExportedFile(filename, mimeType, data) {
  if (Capacitor.isNativePlatform()) {
    const base64 = typeof data === 'string' ? utf8ToBase64(data) : uint8ToBase64(data);
    const written = await Filesystem.writeFile({
      path: filename,
      data: base64,
      directory: Directory.Cache,
    });
    await Share.share({ files: [written.uri], dialogTitle: filename });
  } else {
    const blob = new Blob([data], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }
}

// photoKey／normalizePhotoEntry／normalizePhotoList／dataUrlBytes／
// formatBytes 都搬到 exportData.js 了——這幾個是純函式，跟匯出/刪除
// 功能一起拆出去，方便單獨寫測試，這裡改成 import，行為不變。

// refundMethod 這個欄位是後來才加的，舊收據沒存過這個值，要從當時的
// status 反推。只有 status 剛好停在「已登記」（STAGES 索引 1）才是
// 可靠訊號——這個 app 裡只有主動勾選「有登記退款方式」才會停在這一站。
// 一旦繼續推進到「已查驗」或「已退款」，可能是使用者自己在表單裡一路
// 點過去（那樣真的有登記），也可能是查驗頁的「全部標記為已查驗」直接
// 從「已購買」跳過去（那個動作完全不會讀退款方式，見 CheckView 的
// onVerifyAll）——兩條路徑存下來的 status 長得一樣，分不出來，這時候
// 老實回答「不確定」，不要在沒有真正依據的情況下替使用者捏造答案。
export function inferRefundMethod(initial) {
  if (!initial) return 'unsure';
  if (initial.refundMethod) return initial.refundMethod;
  return STAGES.indexOf(initial.status) === 1 ? 'registered' : 'unsure';
}

// 行程 id 原本只用 `t_${Date.now()}`，跟收據 id（`r_${Date.now()}_隨機
// 碼`）不是同一套規格——快速連續建立兩趟行程（例如快點兩下「建立」）
// 理論上可能撞出同一個毫秒、產生兩筆一樣的 id，其中一筆會變成看不到
// 也刪不掉的幽靈行程。補上跟收據 id 同一套隨機碼。
function genTripId() {
  return `t_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

// 日本有國際定期航線的機場約 34 座，只放這些，不追求完整——找不到就選
// 「其他機場」，用預設 3 小時。region 是地區 key（對應 AIRPORT_REGIONS），
// city 是機場所在城市，hours 是建議提早幾小時（給總覽倒數區跟回程當天
// 流程第一條用）。機場名稱、城市、地區名都是日文原文地名，中日文介面
// 共用同一份，不分開翻譯——跟機場名稱本身一樣，本來就是專有名詞。
const AIRPORTS = [
  // 主要樞紐
  { code: 'NRT', name: '成田国際空港', city: '東京', region: 'hub', hours: 3.5 },
  { code: 'HND', name: '東京国際空港', city: '羽田', region: 'hub', hours: 3 },
  { code: 'KIX', name: '関西国際空港', city: '大阪', region: 'hub', hours: 3.5 },
  { code: 'NGO', name: '中部国際空港', city: '名古屋', region: 'hub', hours: 3 },
  { code: 'FUK', name: '福岡空港', city: '福岡', region: 'hub', hours: 3 },
  // 北海道
  { code: 'CTS', name: '新千歳空港', city: '札幌', region: '北海道', hours: 3 },
  { code: 'HKD', name: '函館空港', city: '函館', region: '北海道', hours: 2.5 },
  { code: 'AKJ', name: '旭川空港', city: '旭川', region: '北海道', hours: 2.5 },
  // 東北
  { code: 'SDJ', name: '仙台空港', city: '仙台', region: '東北', hours: 2.5 },
  { code: 'AOJ', name: '青森空港', city: '青森', region: '東北', hours: 2 },
  { code: 'HNA', name: '花巻空港', city: '岩手', region: '東北', hours: 2 },
  { code: 'AXT', name: '秋田空港', city: '秋田', region: '東北', hours: 2 },
  { code: 'FKS', name: '福島空港', city: '福島', region: '東北', hours: 2 },
  // 関東
  { code: 'IBR', name: '茨城空港', city: '茨城', region: '関東', hours: 2 },
  // 中部・北陸
  { code: 'KMQ', name: '小松空港', city: '石川', region: '中部・北陸', hours: 2.5 },
  { code: 'KIJ', name: '新潟空港', city: '新潟', region: '中部・北陸', hours: 2 },
  { code: 'TOY', name: '富山空港', city: '富山', region: '中部・北陸', hours: 2 },
  { code: 'FSZ', name: '静岡空港', city: '静岡', region: '中部・北陸', hours: 2.5 },
  // 関西
  { code: 'UKB', name: '神戸空港', city: '神戸', region: '関西', hours: 2.5 },
  // 中国
  { code: 'OKJ', name: '岡山空港', city: '岡山', region: '中国', hours: 2 },
  { code: 'HIJ', name: '広島空港', city: '広島', region: '中国', hours: 2.5 },
  { code: 'YGJ', name: '米子空港', city: '鳥取', region: '中国', hours: 2 },
  // 四国
  { code: 'TAK', name: '高松空港', city: '香川', region: '四国', hours: 2 },
  { code: 'MYJ', name: '松山空港', city: '愛媛', region: '四国', hours: 2 },
  { code: 'KCZ', name: '高知空港', city: '高知', region: '四国', hours: 2 },
  // 九州
  { code: 'KMJ', name: '熊本空港', city: '熊本', region: '九州', hours: 2 },
  { code: 'KOJ', name: '鹿児島空港', city: '鹿児島', region: '九州', hours: 2.5 },
  { code: 'KMI', name: '宮崎空港', city: '宮崎', region: '九州', hours: 2 },
  { code: 'OIT', name: '大分空港', city: '大分', region: '九州', hours: 2 },
  { code: 'HSG', name: '佐賀空港', city: '佐賀', region: '九州', hours: 2 },
  // 清單頁副標是「北九州」，但搜尋結果頁改標「福岡県 · 北九州」（讓人
  // 知道北九州在福岡縣）——citySearchLabel 只給搜尋結果用，清單分組
  // 瀏覽仍用 city。
  { code: 'KKJ', name: '北九州空港', city: '北九州', citySearchLabel: '福岡県 · 北九州', region: '九州', hours: 2 },
  // 沖縄
  { code: 'OKA', name: '那覇空港', city: '沖縄', region: '沖縄', hours: 2.5 },
  { code: 'ISG', name: '石垣空港', city: '石垣島', region: '沖縄', hours: 2 },
  { code: 'SHI', name: '下地島空港', city: '宮古島', region: '沖縄', hours: 2 },
];

// 地區清單固定順序；chip 是籌碼列的短標籤，header 是清單裡的組標題
// （中部・北陸在籌碼列縮寫成「中部」，主要樞紐的中日文標籤不一樣，
// 其他地區都是日文地名，中日文介面共用）。
const AIRPORT_REGIONS = [
  { key: 'hub', chip: null, header: null },
  { key: '北海道', chip: '北海道', header: '北海道' },
  { key: '東北', chip: '東北', header: '東北' },
  { key: '関東', chip: '関東', header: '関東' },
  { key: '中部・北陸', chip: '中部', header: '中部・北陸' },
  { key: '関西', chip: '関西', header: '関西' },
  { key: '中国', chip: '中国', header: '中国' },
  { key: '四国', chip: '四国', header: '四国' },
  { key: '九州', chip: '九州', header: '九州' },
  { key: '沖縄', chip: '沖縄', header: '沖縄' },
];
const DEFAULT_ARRIVE_HOURS = 3; // 選了「其他機場」或沒選，一律預設 3 小時

function arriveHoursText(t, hours) {
  const h = Math.floor(hours);
  const half = hours - h >= 0.5;
  return half ? `${h} ${t.hours} 30 ${t.min}` : `${h} ${t.hours}`;
}

function regionLabel(t, region, kind) {
  if (region.key === 'hub') return kind === 'chip' ? t.airportHubChip : t.airportHubHeader;
  return region[kind];
}

// 搜尋比對＋標出命中片段：優先順序是機場名>城市>代碼，只標出「造成
// 這筆結果出現」的那個欄位，不會每個欄位裡出現的字都標（跟 37 號截圖
// 裡福岡空港只標名稱、北九州空港只標城市的行為一致）。
function findMatch(text, q) {
  if (!q) return null;
  const idx = text.toLowerCase().indexOf(q.toLowerCase());
  if (idx === -1) return null;
  return { idx, len: q.length };
}

function Highlight({ text, match }) {
  if (!match) return <>{text}</>;
  return (
    <>
      {text.slice(0, match.idx)}
      <span style={{ color: C.blueDeep, fontWeight: 700, borderBottom: `1px solid ${C.blue}` }}>
        {text.slice(match.idx, match.idx + match.len)}
      </span>
      {text.slice(match.idx + match.len)}
    </>
  );
}

/* 莫蘭迪色票 */
const FONT =
  '"Noto Sans TC", "Noto Sans JP", "Hiragino Sans", "Yu Gothic", "Microsoft JhengHei", system-ui, -apple-system, "Segoe UI", sans-serif';

const C = {
  bg: '#F2F0ED',
  page: '#FFFFFF',
  card: '#FFFFFF',
  soft: '#F4F2EF',
  ink: '#494640',
  sub: '#8B857D',
  line: '#E1DCD5',
  blue: '#77899A',
  blueDeep: '#5C6D7C',
  blueSoft: '#DFE5EA',
  sage: '#93A392',
  sageSoft: '#E1E8DF',
  clay: '#B08D74',
  claySoft: '#EFE2D6',
  clayInk: '#8A6448',
};

const T = {
  zh: {
    appName: 'Kaeru',
    appSub: '日本退稅　先付後退',
    nav: { home: '總覽', list: '收據', check: '查驗', faq: 'FQA', set: '設定' },
    loading: '讀取中',
    departIn: '回程班機起飛前　出発便まで',
    departHint: '設定裡的起飛時間',
    days: '天',
    hours: '小時',
    min: '分',
    setDeparture: '設定回程班機時間',
    arriveBy: '建議抵達機場',
    arriveTagPre: '建議 ',
    arriveTagSuf: ' 抵達',
    beforeCheckin: '託運行李前一定要先辦完海關查驗',
    checkinBadge: '託運前先辦查驗',
    totalSpent: '含稅消費合計',
    estRefund: '預估可退稅額',
    pending: '還沒處理',
    itemsUnit: '張',
    nearestDeadline: '最近到期',
    noDeadline: '沒有待辦',
    emptyHome: '還沒有任何收據。買完東西就記一筆，出境前才不會漏。',
    addFirst: '新增第一張收據',
    departChecklist: '回程當天流程',
    step1: (hrsText) => `提早 ${hrsText}到機場，行李先不要託運`,
    step2: '連上國際線出發大廳的專用無線網路，開啟 VJW',
    step3: '用 VJW 辦海關確認，或到自助機台掃護照',
    step4: '判定通過後再去航空公司櫃檯託運行李',
    receipts: '收據',
    addReceipt: '新增收據',
    groupHint: '同一間店、同一天會合併計算稅抜金額',
    filters: { all: '全部', pending: '待補', todo: '待處理', done: '已完成' },
    noMatch: '這個篩選沒有符合的收據。',
    reached: '已達 5,000 円',
    notReached: '未達 5,000 円',
    short: '還差',
    netTotal: '稅抜合計',
    netBare: '稅抜',
    emptyList: '這裡會列出你所有的收據。',
    shop: '店名',
    date: '購買日期',
    inclAmount: '含稅金額',
    taxRate: '稅率',
    taxAmount: '稅額',
    taxAuto: '自動計算，可手動改',
    netAmount: '稅抜金額',
    refundReg: '已登記退款方式',
    unpacked: '已拆封',
    unpackedHint: '純記錄，不影響退稅',
    consumed: '這張收據裡有東西已在境內吃掉或用掉',
    consumedHint: '整張收據都會無法退稅',
    packNote:
      '拆開包裝沒關係，衣服穿過也沒關係，只要查驗時東西還在、拿得出來就能退。真的吃掉、用掉，東西不在了，那張收據才會整張失效。',
    photo: '收據照片',
    takePhoto: '拍照或選檔',
    photoSheetSub: '照片只存在這台手機裡，不會上傳。',
    takePhotoOption: '拍照',
    takePhotoHint: '開相機，對準收據拍一張',
    chooseFromLibrary: '從相簿選',
    libraryHint: '最多選 4 張',
    scanDoc: '掃描文件',
    scanDocHint: '自動抓邊框、拉正、去陰影',
    frameReminder: '檢查整張收據有沒有拍進框內，最下面的稅率金額要拍到',
    cameraDenied: '沒有相機權限',
    photoDenied: '沒有照片圖庫權限',
    openSettings: '去設定開啟',
    confirmPhoto: '確認照片',
    retakePhoto: '重拍',
    usePhoto: '使用',
    useWithAmount: '使用這張並帶入金額',
    useOnly: '使用這張',
    ocrRecognizing: '辨識中，請稍候…',
    toolAdjustBorder: '調整邊框',
    toolRotate: '旋轉',
    toolContrast: '增強對比',
    edgeAutoOk: '邊框已自動抓好',
    ocrAmountLabel: '從照片讀到的金額',
    ocrHint: '可以直接帶入表單，之後仍可手動改',
    photoDeleteHint: (n) => `右上角 ✕ 刪除。最多 ${n} 張。`,
    photoSectionLabel: (n) => `照片　${n} 張`,
    addPhotoCta: '＋ 加照片',
    photoGroupReceipt: (n) => `收據照片　${n} 張`,
    photoGroupItem: (n) => `物品照片　${n} 張`,
    photoTypeReceiptBadge: '憑證',
    photoTypeHint: '長按任一張可以改型別。物品照片不跑辨識，也不影響金額。',
    photoTypeWhyTitle: '為什麼要分兩種',
    photoTypeWhyDesc: '憑證那張要拿給海關看，也是金額的來源；物品照片只是備忘。',
    photoTypeSheetTitle: '這張照片是？',
    photoTypeReceiptLabel: '收據照片',
    photoTypeReceiptHint: '憑證，跑辨識、是金額來源',
    photoTypeItemLabel: '物品照片',
    photoTypeItemHint: '純備忘，不跑辨識、不影響金額',
    photoStorageNote: '照片只存在這台手機裡。刪收據的時候照片會一起走。',
    zoomHint: '雙指縮放看細節',
    swipeHint: '左右滑動換照片',
    deletePhotoTitle: '刪除這張照片',
    // 原本分「還有其他照片」跟「最後一張」兩種文案——但對金額/狀態
    // 的影響其實一樣（都不影響），那個差異對使用者要不要按下去沒有
    // 幫助，改成一句話講完，兩種情況共用。
    deletePhotoBody: '刪掉這張不影響金額和狀態。刪了就沒了。',
    note: '備註',
    save: '儲存',
    edit: '編輯',
    cancel: '取消',
    discardTitle: '這筆還沒存，要放棄嗎？',
    keepEditing: '繼續編輯',
    discard: '放棄',
    exitPressAgain: '再按一次返回鍵就離開',
    exitDataSafe: '收據都存好了，資料不會不見',
    exitStay: '留下',
    status: '目前狀態',
    stage: {
      purchased: '已購買',
      registered: '已登記退款方式',
      verified: '已通過海關查驗',
      refunded: '已退款',
    },
    stageShort: {
      purchased: '已購買',
      registered: '已登記',
      verified: '已查驗',
      refunded: '已退款',
    },
    stuckAt: '卡在',
    nextStep: '下一步',
    stageNext: {
      purchased: '登記退款方式',
      registered: '海關查驗',
      verified: '退款',
    },
    warnConsumed:
      '這張收據不能退稅。整張收據只要有一項在境內用掉，其他商品也一起失效。請直接跟海關人員申報，不要去機台辦手續。',
    deadCardNote: '同一張收據只要有一項在境內用掉，其他商品也一起失效。請直接跟海關人員申報。',
    warnShort: '這間店這一天的稅抜合計還沒滿 5,000 円，目前不符合退稅條件。',
    warnHigh:
      '如果裡面有稅抜單價滿 100 萬円的商品，海關可能要求出示鑑定書或保證書，記得帶著。',
    warnDeadline: '期限剩',
    dueLeft: '剩',
    expired: '已超過 90 天期限',
    checkTitle: '查驗進度',
    checkIntro: '機場現場自己對　還沒辦完的收據',
    checkLeft: '還剩',
    checkSub: '逐張確認',
    checkCount: '待查驗',
    checkEmpty: '目前沒有符合查驗條件的收據。',
    checkNote: '查驗以一張收據為單位，商品要全部帶在身上。',
    checkDoneRatio: '已辦完',
    checkRefunded: '已退回',
    markVerified: '全部標記為已通過查驗',
    allDone: '都辦完了',
    markOne: '辦完了',
    checkDone: '完成',
    faqTitle: 'FQA',
    faqSection: { buy: '購買時', exit: '出境時', refund: '退款' },
    tipsTitle: '小撇步',
    trips: '行程',
    currentTrip: '目前行程',
    newTrip: '新增行程',
    tripName: '行程名稱',
    tripNamePh: '例如 大阪 11 月',
    tripUnnamed: '未命名行程',
    unfilled: '未填',
    noDeparture: '未設定回程班機時間',
    tripReceipts: '張收據',
    tripSwitch: '切換到這趟',
    tripDelete: '刪除這趟行程',
    depPrefix: '回程',
    tripPast: '過去的行程',
    tripNow: '進行中',
    editTrip: '編輯行程',
    airport: '出境機場',
    airportPick: '選擇出境機場',
    back: '返回',
    airportSearchPh: '搜尋機場、城市或代碼',
    airportSearchHint: (n) => `共 ${n} 座有國際線的機場。機場決定建議抵達時間。`,
    arriveEarlyPrefix: '提早',
    airportSelected: '已選',
    airportOtherHint: '找不到你的機場也沒關係，選「其他機場」就用預設的 3 小時。',
    airportOther: '其他機場',
    airportHubChip: '樞紐',
    airportHubHeader: '主要樞紐',
    airportResultCount: (n) => `${n} 個結果 · 也可以輸入 FUK 這種代碼`,
    airportItmNote: '找不到？大阪的伊丹空港（ITM）目前沒有國際定期航班，出境要到関西国際空港。',
    departureHint: '改了回程時間，總覽的倒數和建議抵達時間會跟著算。',
    setActiveTrip: '設為目前行程',
    setActiveTripHint: '新增收據時預設存到這趟',
    tripReceiptsSection: '這趟的收據',
    inclTotalShort: '含稅合計',
    statusPending: '張待處理',
    statusRefunded: '張已退款',
    statusDead: '張失效',
    deleteTripWarning: (n) => `刪掉這趟，裡面 ${n} 張收據和照片會一起走，沒辦法復原。`,
    tripDeleteMinNote: '至少要保留一個行程，新增另一個之後才能刪除這個。',
    emptyUnnamedKicker: '這趟行程',
    emptyUnnamedTitle: '還沒有名字',
    emptyUnnamedDesc:
      '收據會存進一趟行程裡。先幫這趟取個名字、填上回程時間，之後的倒數和查驗進度才算得出來。',
    emptyUnnamedCta: '先幫這趟行程取個名字',
    emptyUnnamedOr: '或者',
    emptyUnnamedEscape: '先加一張收據，晚點再填',
    emptyUnnamedRulesTitle: '先看懂規則',
    rule1: '同一間店、同一天，稅抜合計滿 5,000 円才能退',
    rule2: '在日本吃掉、用掉的東西，那張收據整張失效',
    rule3: '購買日算起 90 天內要辦完手續',
    tripCreatedBadge: '行程已建立',
    noReceiptsTitle: '還沒有收據',
    noReceiptsDesc:
      '在免稅櫃檯結完帳，就把收據拍進來。同一間店同一天的會自動合併計算。',
    rulesLinkLabel: '先看一遍規則',
    departedTopLabel: '這趟已經結束　帰国済み',
    departedValue: '已出境',
    refundedTotalLabel: '已退回稅額',
    endedSheetTitle: '這趟看起來結束了',
    endedSheetDesc: (name, days, count) =>
      `${name}的回程班機已經飛了 ${days} 天，${count} 張收據也都處理完。要開始新的行程嗎？`,
    endedSheetSettleLabel: '這趟總共退回',
    endedSheetCta: '建立新行程',
    endedSheetNotNow: '先不要',
    endedSheetViewRecords: '看這趟的紀錄',
    endedSheetFooterNote: '舊行程和收據都會留著，隨時可以從選單切回來。',
    create: '建立',
    menu: '功能',
    pickDate: '選日期',
    pickDateTime: '選日期和時間',
    today: '今天',
    clearDate: '清除',
    doneDate: '完成',
    time: '時間',
    weekdays: ['日', '一', '二', '三', '四', '五', '六'],
    navDesc: {
      home: '倒數、金額、回程當天流程',
      list: '新增與管理每一張收據',
      check: '機場現場核對還剩幾張',
      faq: '規則、小撇步、情境模擬',
      set: '匯率、語言、資料',
    },
    menuTrip: '切換行程',
    menuLang: '語言',
    menuAdd: '新增收據',
    menuCurrent: '目前',
    tripCountUnit: '趟行程',
    sim: '試走一趟大阪',
    simSub: '跟著走一趟，看你能退多少',
    startSim: '開始這趟旅程',
    simStep: '決定',
    simGot: '你退到',
    simMax: '這趟最多可退',
    simLost: '漏掉',
    simDone: '這趟走完了',
    simSuccess: '退成功',
    unitDecisions: '個決定',
    simWhy: '漏掉的原因',
    rulesTitle: '規則整理',
    stakeMoney: '會影響金額',
    stakeRule: '規則題',
    stalled: '流程中止 · 不要去機台辦手續',
    stalledShort: '流程中止',
    caseClosed: '已結案',
    cantRefund: '不能退',
    lostTax: '拿不回來',
    refillTip: '當天回同店可補買',
    dead: '整張失效',
    consumedShort: '已在境內消費',
    unpackedShort: '已拆封',
    pendingCheck: '待查驗',
    reachedShort: '已達標',
    markTag: '標記',
    currentTag: '目前',
    delete: '刪除',
    groupTotal: '同店同日合計',
    packNoteShort:
      '拆開包裝、衣服穿過都不算消費。真的吃掉、用掉，東西不在了，才會整張失效。',
    refundedNote:
      '退款由免稅店或它委託的退款業者處理，入帳時間各店不同。對不上的時候先找店家，不是海關。',
    rateHint: '以收據上的標示為準，有 ※ 記號的是 8%。',
    taxRateBoth: '兩種都有',
    tax8Label: '8% 對象',
    tax8Sub: '食品、外帶',
    tax10Label: '10% 對象',
    tax10Sub: '酒類、其他商品',
    inclTotalLabel: '含稅總金額',
    autoFilledHint: '自動帶入',
    taxTotalAuto: '稅額合計（可手動改）',
    notFilled: '還沒填',
    taxMixedPartialHint:
      '照收據上的兩行金額各填一格。這張只有 8% 的話，回上面選 8% 就好。',
    simGood: '這步做對了',
    simBad: '這步有問題',
    simPerfect:
      '全部退成功，沒有漏掉。回收據頁對一次自己的：有沒有未達標的、已經吃掉的、或快到 90 天的。',
    next: '繼續',
    of: '／',
    again: '再走一次',
    backToFaq: '回到 FQA',
    settings: '設定',
    departure: '回程班機時間',
    rate: '匯率 1 円 =',
    twd: '台幣',
    fetchRate: '抓即時匯率',
    fetching: '抓取中',
    rateFail: '抓不到即時匯率，先用現在的數字，也可以自己改。',
    rateAt: '更新於',
    manual: '手動輸入',
    language: '語言',
    source: '規則依據：観光庁 消費税免税店サイト',

    // ---- 匯出與刪除 ----
    dataManageKicker: '資料',
    dataManageTitle: '匯出或刪除資料',
    dataManageRowDesc: '匯出備份、清理照片，或整個重來。',
    dataManageDesc: '收據都在你手機裡，沒有別的地方存。要備份還是要清掉，你自己來就好。',
    dataManageOutro: '刪掉就是刪掉了，沒有還原。手機以外沒有第二份，我們也幫不上。',
    dataManageReceiptCount: (n) => `${n} 張收據`,
    dataManagePhotoUsage: (n, size) => `照片 ${n} 張 · ${size}`,
    exportSectionLabel: '匯出',
    exportThisTrip: '這趟行程',
    exportAllTrips: '全部行程',
    exportCta: '匯出',
    deleteSectionLabel: '刪除',
    deleteEndedTripsRow: (n) => `已結束的行程（${n} 張收據）`,
    deletePhotosOnlyRow: (size) => `只刪照片（留下金額，省下 ${size}）`,
    deleteAllDataRow: '全部資料',
    deleteCta: '刪除',
    noEndedTripsHint: '目前沒有已結束的行程',
    noPhotosHint: '目前沒有照片可以刪',
    csvHeaders: ['行程', '店名', '日期', '含稅金額', '稅率', '退款方式', '狀態', '備註'],
    csvMixedRateLabel: '8%+10%',
    csvUnnamedTrip: '未命名行程',
    exportFormatCsvLabel: 'CSV',
    exportFormatZipLabel: 'ZIP 含照片',
    exportTip1: 'CSV 可以直接用 Excel、Numbers 或記帳軟體打開',
    exportTip2: 'ZIP 版本另外包含每張收據和物品照片，檔案會大很多',
    exportTip3: '待補的欄位留空，不會填 0——空白和零是兩件事',
    exportBoundaryTitle: '匯出之後檔案就離開 App 了',
    exportBoundaryDesc: '存到哪、要不要傳給別人，都是你決定。檔案出去以後，這裡的設定就管不到了。',
    exportCtaCsv: '匯出 CSV',
    exportCtaZip: '匯出 ZIP',
    exportShareHint: '會開啟系統的分享選單',
    exporting: '準備檔案中…',
    exportFailed: '匯出失敗，請再試一次。',
    exportForTrip: (name) => `${name} · 匯出`,
    exportForAll: '全部行程 · 匯出',
    deleteConfirmDesc: (receipts, photos, trips) =>
      `${receipts} 張收據、${photos} 張照片、${trips} 趟行程會一起消失，手機以外沒有第二份。`,
    deleteConfirmReceiptsRow: (n) => `收據與稅額紀錄 ${n} 張`,
    deleteConfirmPhotosRow: (n, size) => `照片 ${n} 張 · ${size}`,
    deleteConfirmTripsRow: (n) => `行程與機場設定 ${n} 趟`,
    deleteConfirmNeverExported: '還沒匯出過',
    deleteConfirmNeverExportedDesc: '要留紀錄的話，先匯出再回來刪。',
    deleteConfirmLastExported: (date) => `上次匯出 ${date}`,
    deleteConfirmExportFirstCta: '先匯出',
    deleteConfirmDeleteCta: '刪除',
    deleteConfirmEndedTitle: '刪除已結束的行程？',
    deleteConfirmAllTitle: '刪除全部資料？',
    deletePhotosOnlyTitle: '只刪照片？',
    deletePhotosOnlyDesc: (size) => `省下 ${size}，金額紀錄會留著。`,
    deletePhotosOnlyCta: '刪除照片',

    // ---- 關於 Kaeru ----
    aboutRowLabel: '關於 Kaeru',
    aboutVersion: (version, date) => `${version} · ${date}`,
    aboutNameOriginKicker: '名字的由來',
    aboutNameOriginDesc: '日文的「かえる」同時是三個意思。退稅這件事剛好三個都用上了。',
    aboutKanji1: '帰る', aboutRomaji1: 'kaeru', aboutMeaning1: '回家', aboutMeaningDesc1: '行程結束前要辦完',
    aboutKanji2: '換える', aboutRomaji2: 'kaeru', aboutMeaning2: '換回來', aboutMeaningDesc2: '把多付的稅換回來',
    aboutKanji3: '蛙', aboutRomaji3: 'kaeru', aboutMeaning3: '青蛙', aboutMeaningDesc3: '所以標誌是一隻蛙',
    aboutWhatKicker: '這個 App 做什麼',
    aboutWhatDesc:
      '只做一件事：在你回家之前，把該退的算清楚、別漏掉。哪張沒達到門檻、哪張快過期、機場要提早多久到，這些都幫你看著。',
    aboutWhatBoundary:
      '不代辦退稅、不碰你的錢，也沒連上海關或免稅店的系統。手續還是在店裡和機場辦。',
    aboutEstimateTitle: '稅額是估算',
    aboutEstimateDesc: '規則以日本國稅廳和各免稅店的公告為準。各店手續費不同，實際入帳可能少一點。',
    aboutPrivacyLink: '隱私說明',
    aboutFeedbackLabel: '回報問題或建議',
    aboutFeedbackEmail: 'shu.developer.tw@gmail.com',

    // ---- 隱私說明 ----
    privacyRowLabel: '隱私說明',
    privacyUpdatedAt: (date) => `更新於 ${date}`,
    privacyTitle: '你的資料在哪裡',
    privacyIntro: '全部在這台手機裡。我們沒有存放收據的伺服器，也沒有帳號要你註冊。',
    privacyRowAmount: '收據金額、店名、日期',
    privacyRowPhotos: '收據與物品照片',
    privacyRowTripSettings: '回程時間、機場、匯率設定',
    privacyRowOcr: '文字辨識（OCR）',
    privacyRowRate: '即時匯率',
    privacyRowRateSub: '只送出幣別代碼，不會送出你的金額',
    privacyRowAnalytics: '使用統計、廣告識別碼',
    privacyBadgeLocalOnly: '只存本機',
    privacyBadgeOnDevice: '手機上跑',
    privacyBadgeConnects: '會連外網',
    privacyBadgeNone: '不收',
    privacyResultsKicker: '所以會有兩個結果',
    privacyResultOffline: '離線也能記帳，只有匯率會停在最後一次更新',
    privacyResultDeleteApp: '刪掉 App 或換手機，收據就沒了',
    privacyExportBoxTitle: '匯出或刪除全部資料',
    privacyExportBoxDesc: '隨時都能做，不用先問我們',
    privacyExportBoxCta: '前往',
    privacyLegalNote:
      '台灣個資法和日本個人情報保護法給你查詢、更正、刪除資料的權利。這些東西本來就在你手上，直接改、直接刪就好。有問題寄',

    // ---- 權限說明 ----
    permissionPrimeTitle: '要用相機和相簿',
    permissionPrimeDesc: '拍收據，或從相簿挑。辨識都在你的手機上跑完，照片不會傳出去。',
    permissionPrimeDoKicker: '會做的事',
    permissionPrimeDo1: '讀取你選的那幾張照片，辨識金額和店名',
    permissionPrimeDo2: '把照片壓縮後存在這台手機裡',
    permissionPrimeDo3: '就這樣。沒有第三步',
    permissionPrimeDontKicker: '不會做的事',
    permissionPrimeDont1: '不會讀取你相簿裡其他照片',
    permissionPrimeDont2: '不會把照片或金額傳到任何伺服器',
    permissionPrimeDont3: '不需要註冊，也沒有帳號',
    permissionPrimeOptionalTitle: '不給也能用',
    permissionPrimeOptionalDesc: '照片不是必要的。金額自己打一樣能用，不會少任何功能。',
    permissionPrimeAllowCta: '允許使用相機和相簿',
    permissionPrimeDeclineCta: '先不要，我自己手動輸入',

    // ---- 2b 體驗調整 ----
    todayActionTitle: '今天要辦的事',
    todayActionLine: (n) => `還有 ${n} 張沒辦完`,
    todayActionDone: '都辦完了',
    goCheck: '去核對',
    deadlineBannerTitle: (n, days) => `${n} 張收據 ${days} 天後過期`,
    deadlineBannerDetail: (amount, shop) => `¥${amount} 拿不回來 · ${shop}`,
    expiredBadge: '已過期',
    filterPendingBanner: (n) => `${n} 張資料待補`,
    filterPendingBannerDesc: '待補的不會算進預估可退稅額。有空再把店名和日期填上。',
    pendingShopPlaceholder: '店名待補',
    pendingCapturedOn: (date) => `${date} 拍的`,
    pendingBadge: '資料待補',
    // 跟 pendingBadge 不一樣——那個是整張收據層級的狀態（清單頁用），
    // 這個是單一欄位層級（快速新增畫面裡「店名和日期」那一列），設計
    // 稿（CLAUDE_CODE_DELTA_體驗調整.md 第 4 節）寫的是「待補」兩個
    // 字，不是「資料待補」，兩個情境的文字本來就不一樣，不能共用一個
    // 翻譯 key。
    pendingFieldBadge: '待補',
    pendingAmountBadge: '金額待補',
    pendingAmountPlaceholder: '金額待補',
    pendingFillLink: '補上店名和日期',
    pendingFillAmountLink: '補上金額',
    pendingFillAllLink: '補上店名、日期和金額',
    quickAddTitle: '拍好了',
    quickAddSave: '存起來',
    quickAddGotAmount: '讀到金額了',
    quickAddReadIncl: '從照片讀到的含稅金額',
    quickAddRateLine: (rate, net, tax) => `稅率 ${rate}% · 稅抜 ¥${net} · 稅額 ¥${tax}`,
    refundQ: '這張在店裡登記退款方式了嗎？',
    refundOptRegistered: '有登記',
    refundOptNo: '沒有',
    refundOptUnsure: '不確定',
    refundHint: '最容易漏掉的一步。沒登記的話，錢不會自動退。',
    pendingFieldsLabel: '店名和日期',
    pendingFieldsDesc: '照片讀不到，晚點再補',
    quickSaveCta: '存起來，晚點再補',
    quickSaveCtaAmountPending: '存起來，金額晚點補',
    quickSaveCtaAmountPendingHint: '金額補上才會算進預估可退稅額',
    quickFullFormCta: '現在就填完整資料',
    quickAddNoAmountBadge: '沒讀到金額',
    quickAddInclPlaceholder: '照收據上的合計填',
    quickAddInclPlaceholderNoPhoto: '記得的話自己填，不記得也可以先空著',
    quickAddRateRequiredBadge: '稅率待選',
    quickAddManualRateHint: '這個你自己知道，不用等辨識。選不出來先留著。',
    quickAddNoAmountDesc: '照片有點模糊，金額沒讀出來。現在填，或回飯店再補都可以。',
    quickAddNoAmountDescItemPhoto:
      '這張存成物品照片了，沒有收據可以帶入金額。記得的話現在填，不記得也可以先存起來、晚點再補。',
    retakePhotoCta: '重拍一張',
    quickAddNotReceiptBadge: '不像收據',
    quickAddNotReceiptTitle: '這張看起來不像收據',
    quickAddNotReceiptDesc:
      '沒有讀到金額和店名。如果這是買到的東西，可以存成物品照片；如果是收據，換個角度、把整張拍進去會比較好讀。',
    quickAddNotReceiptWhatLabel: '物品照片是什麼',
    quickAddNotReceiptTip1: '不跑辨識、不影響金額，只是幫你記得這筆買了什麼',
    quickAddNotReceiptTip2: '一張收據可以放多張，回國對帳時看得出來是哪一筆',
    quickAddNotReceiptTip3: '標錯了隨時可以改回收據照片',
    quickAddSaveAsItemCta: '存成物品照片',
    quickAddRetakeReceiptCta: '重拍收據',
    quickAddKeepAsReceiptCta: '還是當收據，我自己填金額',
    refundCheckTitle: '錢進來了嗎',
    refundCheckSubtitle: (tripName, days) => `${tripName} · 回程後 ${days} 天`,
    refundCheckDesc: (n) =>
      `這趟有 ${n} 張收據通過查驗了。錢已經進帳的請勾起來，這樣才知道還在等哪幾筆。`,
    refundCheckWaiting: '還在等',
    refundCheckInfo:
      '退款由免稅店或它委託的退款業者處理，入帳時間各店不同，兩到三週都算正常。超過一個月還沒進來，先找店家，不是海關。',
    refundCheckNotYet: '還沒收到',
    refundCheckAllIn: '都收到了',
    refundCheckRemindLater: '7 天後再提醒我一次',
    emptyUnnamedSimKicker: '還沒搞懂規則？',
    emptyUnnamedSimDesc:
      '跟著走一趟，看你能退多少。門檻、失效、期限，走完就懂了。',

    // ---- 2b 還沒設定回程時間 ----
    noDepartureTitle: '還不知道你什麼時候回國',
    noDepartureDesc:
      '填了回程時間才能倒數，也才算得出每張收據的期限。行程名稱可以不用取。',
    setDepartureCta: '設定回程時間',
    laterCta: '晚點',
    savedCountLabel: (n) => `已存 ${n} 張收據`,
    viewListCta: '看清單',
    cantCalcYetLabel: '還算不出來的事',
    cantCalcDeadlinePerReceipt: '每張收據還剩幾天',
    deadlinePendingBadge: '期限待定',
    cantCalcDepartDayFlow: '回程當天的流程與提醒',
    notSetBadge: '待設定',
    cantCalcAirportQueue: '出境機場能不能辦、要不要排隊',
    cantCalcNote:
      '收據先存著沒問題，資料都在。回程時間補上之後，上面這些會一起算出來。',
    deadlinePendingBanner: (n) => `${n} 張收據都還沒有期限`,
    deadlinePendingBannerDesc: '期限是從回程時間往回算的',
    deadlinePendingSetCta: '設定',
    savedToastTitle: '收據存好了',
    savedToastDeparturePrompt: '順便設定回程時間？填了才能倒數和算期限。',
    retakeOneMoreCta: '再拍一張',
    deadlinePendingWhatLabel: '期限待定是什麼意思',
    deadlinePendingTip1: '收據本身沒問題，金額照算，只是算不出還剩幾天',
    deadlinePendingTip2: '點這個標籤直接跳去填回程時間，填完全部一起換成天數',
    deadlinePendingTip3: '不要猜一個日期填進去。猜錯比空著更危險',
    deadlinePendingNote:
      '對帳時人通常在飯店，那才是填航班的好時機 — 所以提醒放在這裡，不是放在店裡。',
  },
  ja: {
    appName: 'Kaeru',
    appSub: '免税リファンド方式',
    nav: {
      home: 'ホーム',
      list: 'レシート',
      check: '確認',
      faq: 'FQA',
      set: '設定',
    },
    loading: '読み込み中',
    departIn: '出発便まで',
    departHint: '設定の離陸時刻',
    days: '日',
    hours: '時間',
    min: '分',
    setDeparture: '出発時刻を設定',
    arriveBy: '空港到着の目安',
    arriveTagPre: '空港到着 ',
    arriveTagSuf: '',
    beforeCheckin: '手荷物を預ける前に税関確認を終わらせてください',
    checkinBadge: '預ける前に税関確認',
    totalSpent: '税込合計',
    estRefund: '返金見込み額',
    pending: '未処理',
    itemsUnit: '件',
    nearestDeadline: '最短の期限',
    noDeadline: '未処理なし',
    emptyHome:
      'まだレシートがありません。買ったらすぐ登録しておくと出国時に困りません。',
    addFirst: '最初のレシートを追加',
    departChecklist: '出発当日の流れ',
    step1: (hrsText) => `${hrsText}前に空港へ。荷物はまだ預けない`,
    step2: '国際線出発ロビーの専用無線 LAN に接続し VJW を開く',
    step3: 'VJW で税関確認、または端末でパスポートを読み取る',
    step4: '判定後に航空会社カウンターで荷物を預ける',
    receipts: 'レシート',
    addReceipt: 'レシートを追加',
    groupHint: '同一店舗・同一日は税抜金額が合算されます',
    filters: {
      all: 'すべて',
      pending: '情報待ち',
      todo: '未処理',
      done: '完了',
    },
    noMatch: '該当するレシートはありません。',
    reached: '5,000 円達成',
    notReached: '5,000 円未満',
    short: 'あと',
    netTotal: '税抜合計',
    netBare: '税抜',
    emptyList: '登録したレシートがここに並びます。',
    shop: '店舗名',
    date: '購入日',
    inclAmount: '税込金額',
    taxRate: '税率',
    taxAmount: '消費税額',
    taxAuto: '自動計算・手動変更可',
    netAmount: '税抜金額',
    refundReg: '返金方法 登録済み',
    unpacked: '開封済み',
    unpackedHint: '記録のみ・返金に影響なし',
    consumed: 'このレシートに国内で消費した物品がある',
    consumedHint: 'レシート全体が返金対象外になります',
    packNote:
      '開封や着用は問題ありません。確認時に所持していれば対象です。消費して所持していない場合のみ、そのレシート全体が対象外になります。',
    photo: 'レシート写真',
    takePhoto: '撮影または選択',
    photoSheetSub: '写真はこの端末にだけ保存されます。アップロードはされません。',
    takePhotoOption: '写真を撮る',
    takePhotoHint: 'カメラを起動してレシートを撮影',
    chooseFromLibrary: 'フォトライブラリから選ぶ',
    libraryHint: '最大 4 枚まで選択',
    scanDoc: '文書をスキャン',
    scanDocHint: '枠を自動検出・補正、影も除去',
    frameReminder: 'レシート全体が写っているか確認してください。下部の税率・金額も撮れていますか？',
    cameraDenied: 'カメラの権限がありません',
    photoDenied: 'フォトライブラリの権限がありません',
    openSettings: '設定を開く',
    confirmPhoto: '写真を確認',
    retakePhoto: '再撮影',
    usePhoto: '使用',
    useWithAmount: 'この写真を使って金額を入力',
    useOnly: 'この写真を使う',
    ocrRecognizing: '認識中です、少々お待ちください…',
    toolAdjustBorder: '枠を調整',
    toolRotate: '回転',
    toolContrast: 'コントラスト強化',
    edgeAutoOk: '枠を自動検出済み',
    ocrAmountLabel: '写真から読み取った金額',
    ocrHint: 'そのままフォームに入力できます。後で手動修正も可能',
    photoDeleteHint: (n) => `右上の ✕ で削除。最大 ${n} 枚。`,
    photoSectionLabel: (n) => `写真　${n}枚`,
    addPhotoCta: '＋ 写真を追加',
    photoGroupReceipt: (n) => `レシート写真　${n}枚`,
    photoGroupItem: (n) => `商品写真　${n}枚`,
    photoTypeReceiptBadge: '証拠',
    photoTypeHint: '長押しで種類を変更できます。商品写真は文字認識をせず、金額にも影響しません。',
    photoTypeWhyTitle: 'なぜ2種類に分けるのか',
    photoTypeWhyDesc: 'レシート写真は税関提示用で金額の根拠にもなります。商品写真は備忘録です。',
    photoTypeSheetTitle: 'この写真の種類は？',
    photoTypeReceiptLabel: 'レシート写真',
    photoTypeReceiptHint: '証拠として使用、文字認識の対象',
    photoTypeItemLabel: '商品写真',
    photoTypeItemHint: '備忘録のみ、文字認識も金額にも影響なし',
    photoStorageNote: '写真はこの端末にだけ保存されます。レシートを削除すると、写真も一緒に削除されます。',
    zoomHint: 'ピンチで拡大',
    swipeHint: '左右にスワイプで切り替え',
    deletePhotoTitle: 'この写真を削除',
    deletePhotoBody: 'この写真を削除しても金額やステータスには影響しません。削除すると元に戻せません。',
    note: 'メモ',
    save: '保存',
    edit: '編集',
    cancel: 'キャンセル',
    discardTitle: 'まだ保存されていません。破棄しますか？',
    keepEditing: '編集を続ける',
    discard: '破棄',
    exitPressAgain: 'もう一度戻るボタンを押すと終了します',
    exitDataSafe: 'レシートは保存済みです。データは消えません',
    exitStay: '留まる',
    status: 'ステータス',
    stage: {
      purchased: '購入済み',
      registered: '返金方法 登録済み',
      verified: '税関確認 済み',
      refunded: '返金済み',
    },
    stageShort: {
      purchased: '購入済み',
      registered: '登録済み',
      verified: '確認済み',
      refunded: '返金済み',
    },
    stuckAt: '停滞：',
    nextStep: '次は',
    stageNext: {
      purchased: '返金方法登録',
      registered: '税関確認',
      verified: '返金',
    },
    warnConsumed:
      'このレシートは返金を受けられません。1 つでも国内で消費するとレシート全体が対象外です。端末では手続せず、税関職員に申し出てください。',
    deadCardNote:
      '同一レシート内で 1 つでも国内消費すると、他の商品も対象外になります。税関職員に申し出てください。',
    warnShort: '同一店舗・同一日の税抜合計が 5,000 円に達していません。',
    warnHigh:
      '税抜単価 100 万円以上の商品がある場合、鑑定書や保証書の提示を求められることがあります。',
    warnDeadline: '期限まで残り',
    dueLeft: '残り',
    expired: '90 日の期限を過ぎています',
    checkTitle: '手続きの進捗',
    checkIntro: '空港で自分で確認　未処理のレシート',
    checkLeft: '残り',
    checkSub: '1 件ずつ確認',
    checkCount: '確認待ち',
    checkEmpty: '確認対象のレシートはありません。',
    checkNote: '税関確認はレシート単位です。商品はすべて所持してください。',
    checkDoneRatio: '完了',
    checkRefunded: '返金済み',
    markVerified: 'すべて確認済みにする',
    allDone: 'すべて完了にする',
    markOne: '完了にする',
    checkDone: '完了',
    faqTitle: 'FQA',
    faqSection: { buy: '購入時', exit: '出国時', refund: '返金' },
    tipsTitle: 'コツ',
    trips: '旅程',
    currentTrip: '現在の旅程',
    newTrip: '旅程を追加',
    tripName: '旅程名',
    tripNamePh: '例：大阪 11 月',
    tripUnnamed: '名前未設定の旅程',
    unfilled: '未入力',
    noDeparture: '出発時刻 未設定',
    tripReceipts: '件',
    tripSwitch: 'この旅程に切り替え',
    tripDelete: 'この旅程を削除',
    depPrefix: '出発',
    tripPast: '過去の旅程',
    tripNow: '進行中',
    editTrip: '旅程を編集',
    airport: '出発空港',
    airportPick: '出発空港を選択',
    back: '戻る',
    airportSearchPh: '空港名・都市名・略称で検索',
    airportSearchHint: (n) => `国際線のある空港 ${n} カ所。空港によって到着目安が変わります。`,
    arriveEarlyPrefix: '目安',
    airportSelected: '選択中',
    airportOtherHint: '見つからなければ「その他の空港」を選べば、デフォルトの3時間で計算します。',
    airportOther: 'その他の空港',
    airportHubChip: '拠点',
    airportHubHeader: '主要空港',
    airportResultCount: (n) => `${n} 件 · FUK のような略称でも検索できます`,
    airportItmNote: '見つからない？大阪の伊丹空港（ITM）は現在国際定期便がありません。関西国際空港をご利用ください。',
    departureHint: '出発時刻を変えると、ホームのカウントダウンと到着目安も一緒に変わります。',
    setActiveTrip: '現在の旅程にする',
    setActiveTripHint: 'レシート追加時のデフォルト保存先になります',
    tripReceiptsSection: 'この旅程のレシート',
    inclTotalShort: '合計（税込）',
    statusPending: '件 未処理',
    statusRefunded: '件 返金済み',
    statusDead: '件 失効',
    deleteTripWarning: (n) => `旅程を削除すると、この ${n} 件のレシートと App 内に保存された写真の複製も一緒に削除されます。元に戻せません。`,
    tripDeleteMinNote: '旅程は最低 1 件必要です。もう 1 件追加すると、これを削除できます。',
    emptyUnnamedKicker: 'この旅程',
    emptyUnnamedTitle: 'まだ名前がありません',
    emptyUnnamedDesc:
      'レシートは旅程に紐づいて保存されます。まず名前と帰国時刻を入れておくと、カウントダウンや確認の進み具合が計算できるようになります。',
    emptyUnnamedCta: 'この旅程に名前をつける',
    emptyUnnamedOr: 'または',
    emptyUnnamedEscape: '先にレシートを追加して、あとで入力する',
    emptyUnnamedRulesTitle: 'ルールを先に知っておく',
    rule1: '同一店舗・同一日、税抜合計 5,000 円以上で返金対象',
    rule2: '日本国内で消費・使用した物は、そのレシート全体が無効',
    rule3: '購入日から 90 日以内に手続きが必要',
    tripCreatedBadge: '旅程を作成済み',
    noReceiptsTitle: 'まだレシートがありません',
    noReceiptsDesc:
      '免税カウンターで会計したら、レシートを撮影してください。同一店舗・同一日のものは自動でまとめて計算されます。',
    rulesLinkLabel: 'ルールを先に確認する',
    departedTopLabel: 'この旅は終わりました',
    departedValue: '帰国済み',
    refundedTotalLabel: '返金済み額',
    endedSheetTitle: 'この旅程は終わったようです',
    endedSheetDesc: (name, days, count) =>
      `${name}の帰国便が飛んでから ${days} 日、レシート ${count} 件も処理済みです。新しい旅程を始めますか？`,
    endedSheetSettleLabel: '今回の返金合計',
    endedSheetCta: '新しい旅程を作る',
    endedSheetNotNow: '今はしない',
    endedSheetViewRecords: 'この旅程の記録を見る',
    endedSheetFooterNote:
      '前の旅程とレシートはそのまま残ります。メニューからいつでも切り替えられます。',
    create: '作成',
    menu: 'メニュー',
    pickDate: '日付を選択',
    pickDateTime: '日時を選択',
    today: '今日',
    clearDate: 'クリア',
    doneDate: '完了',
    time: '時刻',
    weekdays: ['日', '月', '火', '水', '木', '金', '土'],
    navDesc: {
      home: 'カウントダウン、金額、帰国当日の流れ',
      list: 'レシートの追加と管理',
      check: '空港で残り件数を確認',
      faq: 'ルール・コツ・シミュレーション',
      set: 'レート、言語、データ',
    },
    menuTrip: '旅程を切り替え',
    menuLang: '言語',
    menuAdd: 'レシートを追加',
    menuCurrent: '現在',
    tripCountUnit: '件の旅程',
    sim: '大阪を試し歩き',
    simSub: '歩いてみれば、いくら返ってくるかわかります',
    startSim: '旅を始める',
    simStep: '判断',
    simGot: '返金額',
    simMax: '満額',
    simLost: '損失',
    simDone: 'この旅は終わりました',
    simSuccess: '成功',
    unitDecisions: '件の判断',
    simWhy: '失った理由',
    rulesTitle: 'ルールまとめ',
    stakeMoney: '金額に影響',
    stakeRule: 'ルール問題',
    stalled: '手続中止 · 端末では手続しない',
    stalledShort: '手続中止',
    caseClosed: '対応完了',
    cantRefund: '返金不可',
    lostTax: '返金されません',
    refillTip: '同じ日に同じ店で買い足せば合算',
    dead: 'レシート全体が対象外',
    consumedShort: '国内で消費',
    unpackedShort: '開封済み',
    pendingCheck: '確認待ち',
    reachedShort: '達成',
    markTag: '設定',
    currentTag: '現在',
    delete: '削除',
    groupTotal: '同一店舗・同一日 合計',
    packNoteShort:
      '開封や着用は消費にあたりません。食べた・使い切った場合のみ、レシート全体が対象外になります。',
    refundedNote:
      '返金は免税店または委託された返金事業者が処理します。入金時期は店舗により異なります。合わない場合は、税関ではなく店舗にご確認ください。',
    rateHint: 'レシートの表示を優先。※ マークは 8% 対象。',
    taxRateBoth: '両方あり',
    tax8Label: '8% 対象',
    tax8Sub: '食品・持ち帰り',
    tax10Label: '10% 対象',
    tax10Sub: '酒類・その他',
    inclTotalLabel: '税込総額',
    autoFilledHint: '自動反映',
    taxTotalAuto: '消費税額合計（手動変更可）',
    notFilled: '未入力',
    taxMixedPartialHint:
      'レシートの 2 行の金額をそれぞれ入力してください。8% だけならレシートの表示に戻って 8% を選んでください。',
    simGood: 'この判断は正解',
    simBad: 'この判断は問題あり',
    simPerfect:
      '満額返金、漏れはありません。レシート一覧で自分の分も確認しましょう：5,000 円に届いていないもの、消費してしまったもの、90 日が近いものがないか。',
    next: '次へ',
    of: '／',
    again: 'もう一度',
    backToFaq: 'FQA に戻る',
    settings: '設定',
    departure: '出発時刻（離陸）',
    rate: 'レート 1 円 =',
    twd: '台湾ドル',
    fetchRate: '最新レートを取得',
    fetching: '取得中',
    rateFail: 'レートを取得できませんでした。手動で入力できます。',
    rateAt: '更新',
    manual: '手動入力',
    language: '言語',
    source: '出典：観光庁 消費税免税店サイト',

    // ---- 書き出しと削除 ----
    dataManageKicker: 'データ',
    dataManageTitle: '書き出しまたは削除',
    dataManageRowDesc: 'バックアップの書き出し、写真の整理、まっさらな状態に戻す。',
    dataManageDesc: 'レシートはこの端末の中にあるだけです。バックアップも削除も、ご自身で行ってください。',
    dataManageOutro: '削除したら元には戻りません。この端末以外に控えはありませんので、ご了承ください。',
    dataManageReceiptCount: (n) => `レシート ${n} 件`,
    dataManagePhotoUsage: (n, size) => `写真 ${n}枚 · ${size}`,
    exportSectionLabel: '書き出し',
    exportThisTrip: 'この旅程',
    exportAllTrips: 'すべての旅程',
    exportCta: '書き出し',
    deleteSectionLabel: '削除',
    deleteEndedTripsRow: (n) => `終了した旅程（レシート ${n} 件）`,
    deletePhotosOnlyRow: (size) => `写真のみ削除（金額は残り、${size} 節約）`,
    deleteAllDataRow: 'すべてのデータ',
    deleteCta: '削除',
    noEndedTripsHint: '終了した旅程はまだありません',
    noPhotosHint: '削除できる写真がありません',
    csvHeaders: ['旅程', '店名', '購入日', '税込金額', '税率', '返金方法', '状態', 'メモ'],
    csvMixedRateLabel: '8%+10%',
    csvUnnamedTrip: '名前未設定の旅程',
    exportFormatCsvLabel: 'CSV',
    exportFormatZipLabel: 'ZIP（写真を含む）',
    exportTip1: 'CSV は Excel・Numbers・会計ソフトで直接開けます',
    exportTip2: 'ZIP 版はレシートと商品写真も含むため、ファイルがかなり大きくなります',
    exportTip3: '未入力の項目は空欄のまま——0 を入力すると空欄とは違う意味になります',
    exportBoundaryTitle: '書き出した後、ファイルはアプリの外に出ます',
    exportBoundaryDesc:
      'どこに保存するか、誰かに渡すかはあなた次第です。そのファイルはこのアプリの設定の保護を受けません。',
    exportCtaCsv: 'CSV を書き出す',
    exportCtaZip: 'ZIP を書き出す',
    exportShareHint: 'システムの共有シートが開きます',
    exporting: 'ファイルを準備中…',
    exportFailed: '書き出しに失敗しました。もう一度お試しください。',
    exportForTrip: (name) => `${name} · 書き出し`,
    exportForAll: 'すべての旅程 · 書き出し',
    deleteConfirmDesc: (receipts, photos, trips) =>
      `レシート ${receipts} 件、写真 ${photos} 枚、旅程 ${trips} 件が一緒に消えます。この端末以外に控えはありません。`,
    deleteConfirmReceiptsRow: (n) => `レシートと税額の記録 ${n} 件`,
    deleteConfirmPhotosRow: (n, size) => `写真 ${n}枚 · ${size}`,
    deleteConfirmTripsRow: (n) => `旅程と空港設定 ${n} 件`,
    deleteConfirmNeverExported: 'まだ書き出していません',
    deleteConfirmNeverExportedDesc: '記録を残したいなら、先に書き出してから削除してください。',
    deleteConfirmLastExported: (date) => `前回の書き出し：${date}`,
    deleteConfirmExportFirstCta: '先に書き出す',
    deleteConfirmDeleteCta: '削除',
    deleteConfirmEndedTitle: '終了した旅程を削除しますか？',
    deleteConfirmAllTitle: 'すべてのデータを削除しますか？',
    deletePhotosOnlyTitle: '写真のみ削除しますか？',
    deletePhotosOnlyDesc: (size) => `${size} 節約できます。金額の記録は残ります。`,
    deletePhotosOnlyCta: '写真を削除',

    // ---- Kaeru について ----
    aboutRowLabel: 'Kaeru について',
    aboutVersion: (version, date) => `${version} · ${date}`,
    aboutNameOriginKicker: '名前の由来',
    aboutNameOriginDesc: '日本語の「かえる」には同時に三つの意味があります。免税の手続きにはこの三つがちょうど当てはまります。',
    aboutKanji1: '帰る', aboutRomaji1: 'kaeru', aboutMeaning1: '帰宅', aboutMeaningDesc1: '旅程が終わる前に済ませる',
    aboutKanji2: '換える', aboutRomaji2: 'kaeru', aboutMeaning2: '交換', aboutMeaningDesc2: '払い過ぎた税金を取り戻す',
    aboutKanji3: '蛙', aboutRomaji3: 'kaeru', aboutMeaning3: 'カエル', aboutMeaningDesc3: 'だからロゴはカエルです',
    aboutWhatKicker: 'このアプリでできること',
    aboutWhatDesc:
      'やることは一つだけです。帰国前に、返ってくるはずの税金を漏れなく計算します。門限に達していないレシート、期限が近いレシート、空港にどれくらい前に着くべきか、すべてここで確認できます。',
    aboutWhatBoundary:
      '免税の代行はせず、あなたのお金にも触れません。税関や免税店のシステムとも連携していません。手続きは店舗と空港で行ってください。',
    aboutEstimateTitle: '税額は概算です',
    aboutEstimateDesc: '規則は日本国税庁と各免税店の案内に基づきます。店舗ごとの手数料により、実際の返金額は少なくなることがあります。',
    aboutPrivacyLink: 'プライバシーについて',
    aboutFeedbackLabel: '不具合の報告・ご意見',
    aboutFeedbackEmail: 'shu.developer.tw@gmail.com',

    // ---- プライバシーについて ----
    privacyRowLabel: 'プライバシーについて',
    privacyUpdatedAt: (date) => `更新日 ${date}`,
    privacyTitle: 'データの保管場所',
    privacyIntro: 'すべてこの端末の中にあります。Kaeru はレシートを保管するサーバーを持たず、アカウント登録もありません。',
    privacyRowAmount: 'レシートの金額・店名・購入日',
    privacyRowPhotos: 'レシートと商品の写真',
    privacyRowTripSettings: '出発時刻・空港・レートの設定',
    privacyRowOcr: '文字認識（OCR）',
    privacyRowRate: 'リアルタイムのレート',
    privacyRowRateSub: '通貨コードのみ送信。金額は送信しません',
    privacyRowAnalytics: '利用統計・広告識別子',
    privacyBadgeLocalOnly: '端末内のみ',
    privacyBadgeOnDevice: '端末内で処理',
    privacyBadgeConnects: '通信あり',
    privacyBadgeNone: '取得しません',
    privacyResultsKicker: 'つまり二つのことが言えます',
    privacyResultOffline: 'オフラインでも記録できます。レートだけ最後に更新した値のままです',
    privacyResultDeleteApp: 'アプリを削除すると、レシートも消えます',
    privacyExportBoxTitle: 'データの書き出し・削除',
    privacyExportBoxDesc: 'いつでもできます。当社への連絡は不要です',
    privacyExportBoxCta: '開く',
    privacyLegalNote:
      '台湾の個人資料保護法および日本の個人情報保護法により、データの確認・修正・削除を求める権利があります。データはお使いの端末にありますので、直接変更・削除していただけます。ご不明点は',

    // ---- 権限説明 ----
    permissionPrimeTitle: 'カメラと写真へのアクセス',
    permissionPrimeDesc: 'レシートを撮影するか、写真から選びます。文字認識はすべて端末上で行われ、写真は外部に送信されません。',
    permissionPrimeDoKicker: '行うこと',
    permissionPrimeDo1: '選んだ写真を読み取り、金額と店名を認識します',
    permissionPrimeDo2: '写真を圧縮してこの端末に保存します',
    permissionPrimeDo3: 'それだけです。他には何もしません',
    permissionPrimeDontKicker: '行わないこと',
    permissionPrimeDont1: '写真アプリ内の他の写真は読み取りません',
    permissionPrimeDont2: '写真や金額をサーバーに送信しません',
    permissionPrimeDont3: '登録やアカウント作成は不要です',
    permissionPrimeOptionalTitle: '許可しなくても使えます',
    permissionPrimeOptionalDesc: '写真は必須ではありません。金額を自分で入力しても、機能は変わりません。',
    permissionPrimeAllowCta: 'カメラと写真へのアクセスを許可',
    permissionPrimeDeclineCta: '今はしない。自分で入力します',

    // ---- 2b 體驗調整 ----
    todayActionTitle: '今日やること',
    todayActionLine: (n) => `残り ${n} 件`,
    todayActionDone: 'すべて完了',
    goCheck: '確認へ',
    deadlineBannerTitle: (n, days) => `レシート ${n} 件が ${days} 日後に期限切れ`,
    deadlineBannerDetail: (amount, shop) => `¥${amount} が戻らなくなります · ${shop}`,
    expiredBadge: '期限切れ',
    filterPendingBanner: (n) => `${n} 件の情報待ち`,
    filterPendingBannerDesc:
      '情報待ちのレシートは返金見込み額に含まれません。時間があるときに不足している情報を入力してください。',
    pendingShopPlaceholder: '店舗名 未入力',
    pendingCapturedOn: (date) => `${date} 撮影`,
    pendingBadge: '情報待ち',
    pendingFieldBadge: '未入力',
    pendingAmountBadge: '金額未入力',
    pendingAmountPlaceholder: '金額未入力',
    pendingFillLink: '店舗名と購入日を入力',
    pendingFillAmountLink: '金額を入力',
    pendingFillAllLink: '店舗名・購入日・金額を入力',
    quickAddTitle: '撮影完了',
    quickAddSave: '保存',
    quickAddGotAmount: '金額を読み取りました',
    quickAddReadIncl: '写真から読み取った税込金額',
    quickAddRateLine: (rate, net, tax) => `税率 ${rate}% · 税抜 ¥${net} · 消費税額 ¥${tax}`,
    refundQ: 'このレシート、お店で返金方法を登録しましたか？',
    refundOptRegistered: '登録した',
    refundOptNo: 'していない',
    refundOptUnsure: 'わからない',
    refundHint:
      '一番忘れやすいステップです。登録していないと、返金は自動的には行われません。',
    pendingFieldsLabel: '店舗名と購入日',
    pendingFieldsDesc: '写真から読み取れませんでした。後で入力してください',
    quickSaveCta: '保存して後で入力',
    quickSaveCtaAmountPending: '保存して金額は後で入力',
    quickSaveCtaAmountPendingHint: '金額を入力すると返金見込み額に反映されます',
    quickFullFormCta: '今すぐ全部入力する',
    quickAddNoAmountBadge: '金額を読み取れませんでした',
    quickAddInclPlaceholder: 'レシートの合計を入力',
    quickAddInclPlaceholderNoPhoto: '分かれば入力、分からなければ空欄でも大丈夫です',
    quickAddRateRequiredBadge: '税率も選択してください',
    quickAddManualRateHint: '税率は自分で分かるはず。判定を待たなくて大丈夫。選べなければそのままでも保存できます。',
    quickAddNoAmountDesc:
      '写真が少し不明瞭で、金額を読み取れませんでした。今すぐ入力しても、後でホテルに戻ってから入力しても構いません。',
    quickAddNoAmountDescItemPhoto:
      'この写真は商品写真として保存しました。レシートがないので金額は自動入力されません。分かれば今すぐ入力、分からなければ保存して後で入力しても構いません。',
    retakePhotoCta: '撮り直す',
    quickAddNotReceiptBadge: 'レシートではないようです',
    quickAddNotReceiptTitle: 'この写真、レシートではないようです',
    quickAddNotReceiptDesc:
      '金額も店舗名も読み取れませんでした。購入した商品の写真なら「商品写真」として保存できます。レシートなら、角度を変えて全体を写すと読み取りやすくなります。',
    quickAddNotReceiptWhatLabel: '商品写真とは',
    quickAddNotReceiptTip1: '文字認識をせず、金額にも影響しません。買った物の記録用です',
    quickAddNotReceiptTip2: '1件のレシートに複数枚保存できます。帰国後の確認に便利です',
    quickAddNotReceiptTip3: '種類はいつでもレシート写真に変更できます',
    quickAddSaveAsItemCta: '商品写真として保存',
    quickAddRetakeReceiptCta: 'レシートを撮り直す',
    quickAddKeepAsReceiptCta: 'このままレシートとして扱い、金額を自分で入力する',
    refundCheckTitle: '返金は届きましたか',
    refundCheckSubtitle: (tripName, days) => `${tripName} · 帰国後 ${days} 日`,
    refundCheckDesc: (n) =>
      `今回、確認済みのレシートが ${n} 件あります。入金済みのものにチェックを入れてください。`,
    refundCheckWaiting: '未入金',
    refundCheckInfo:
      '返金は免税店または委託された返金事業者が処理します。入金時期は店舗により異なり、2〜3 週間は正常です。1 か月を過ぎても届かない場合は、税関ではなく店舗にご確認ください。',
    refundCheckNotYet: 'まだ届いていない',
    refundCheckAllIn: 'すべて届いた',
    refundCheckRemindLater: '7 日後にもう一度知らせる',
    emptyUnnamedSimKicker: 'ルールがまだよくわからない？',
    emptyUnnamedSimDesc:
      '歩いてみれば、いくら返ってくるかわかります。下限・無効・期限、歩き終わればわかります。',

    // ---- 2b 出発便の時間が未設定 ----
    noDepartureTitle: '帰国日がまだ分かりません',
    noDepartureDesc:
      '出発便の時間を入力すると、カウントダウンと各レシートの期限が計算できるようになります。旅程の名前は設定不要です。',
    setDepartureCta: '出発時刻を設定',
    laterCta: '後で',
    savedCountLabel: (n) => `${n} 件のレシートを保存済み`,
    viewListCta: 'リストを見る',
    cantCalcYetLabel: 'まだ計算できないこと',
    cantCalcDeadlinePerReceipt: '各レシートの残り日数',
    deadlinePendingBadge: '期限未定',
    cantCalcDepartDayFlow: '出発当日の流れとお知らせ',
    notSetBadge: '未設定',
    cantCalcAirportQueue: '出国時の手続きや混雑状況',
    cantCalcNote:
      'レシートは保存済みなので大丈夫です、データは全部残っています。出発便の時間を入力すると、上記がまとめて計算されます。',
    deadlinePendingBanner: (n) => `${n} 件のレシートの期限が未定です`,
    deadlinePendingBannerDesc: '期限は出発便の時間から逆算されます',
    deadlinePendingSetCta: '設定',
    savedToastTitle: 'レシートを保存しました',
    savedToastDeparturePrompt:
      'ついでに出発便の時間を設定しますか？入力するとカウントダウンと期限が計算できます。',
    retakeOneMoreCta: 'もう1枚撮影',
    deadlinePendingWhatLabel: '期限未定とはどういうことか',
    deadlinePendingTip1:
      'レシート自体に問題はなく、金額もそのまま計算されます。ただ残り日数だけ分かりません',
    deadlinePendingTip2:
      'このタグをタップすると出発便の時間の入力に進みます。入力すると一括で日数表示に変わります',
    deadlinePendingTip3: '日付を当て推量で入力しないでください。誤った日付は空欄より危険です',
    deadlinePendingNote:
      '照合作業は通常ホテルで行うもの — フライト情報の入力にはそちらが向いているので、このお知らせは店頭ではなくここに置いています。',
  },
};

const QA = [
  {
    sec: 'buy',
    q: { zh: '免稅門檻是多少？', ja: '免税の下限はいくらですか。' },
    a: {
      zh: '同一間店、同一天，稅抜合計滿 5,000 円就符合。新制取消一般品和消耗品的區分，零食、藥妝、家電可以一起合併算。',
      ja: '同一店舗・同一日の税抜合計が 5,000 円以上。一般物品と消耗品の区分が廃止され、まとめて計算できます。',
    },
  },
  {
    sec: 'buy',
    q: { zh: '消費稅是幾 %？', ja: '消費税は何 % ですか。' },
    a: {
      zh: '食品適用輕減稅率 8%，其他商品 10%。要注意酒類和外食不算在輕減稅率裡，一樣是 10%。退稅退的就是這筆稅額，所以同樣金額的食品和化妝品，退回來的錢會不一樣。',
      ja: '飲食料品は軽減税率 8%、その他は 10% です。酒類と外食は軽減税率の対象外で 10% になります。返金されるのはこの消費税額です。',
    },
  },
  {
    sec: 'buy',
    q: { zh: '可以先拆開包裝嗎？', ja: '開封してもいいですか。' },
    a: {
      zh: '可以。新制取消了特殊密封袋，拆開沒問題。但只要在日本境內吃掉、用掉，就不能退稅，這時候不要去機台辦手續，直接跟海關人員申報。',
      ja: '問題ありません。特殊包装は廃止されました。ただし国内で消費した場合は返金を受けられません。端末では手続せず、税関職員に申し出てください。',
    },
  },
  {
    sec: 'buy',
    q: { zh: '結帳時要付多少？', ja: '会計時にいくら払いますか。' },
    a: {
      zh: '付含稅價。消費稅要等出境查驗通過之後才退還。',
      ja: '税込価格を支払います。消費税は出国時の税関確認後に返金されます。',
    },
  },
  {
    sec: 'buy',
    q: { zh: '買的數量有限制嗎？', ja: '数量に制限はありますか。' },
    a: {
      zh: '限本人出境時能自己帶著出去的數量。所有商品都要能拿給海關看。',
      ja: '出国時に自ら所持して持ち出せる数量に限られます。すべて税関に提示できるようにしてください。',
    },
  },
  {
    sec: 'exit',
    q: { zh: '什麼是 VJW，要先辦嗎？', ja: 'VJW とは何ですか。先に登録が必要ですか。' },
    a: {
      zh: 'Visit Japan Web，日本官方的入出境線上服務，出發前先註冊比較省時間。成田、羽田、關西、中部、新千歲、福岡、那霸這 7 個機場，連上機場指定 WiFi 後可以直接用手機辦海關確認，不必排自助機台。其他機場還是走機台。',
      ja: 'Visit Japan Web は日本の公式な出入国オンラインサービスです。出発前に登録しておくと時間の節約になります。成田・羽田・関西・中部・新千歳・福岡・那覇の 7 空港では、空港指定の Wi-Fi に接続すればスマートフォンでそのまま税関確認ができ、端末に並ぶ必要がありません。その他の空港は引き続き端末での手続になります。',
    },
  },
  {
    sec: 'exit',
    q: { zh: 'VJW 看得到退款進度嗎？', ja: 'VJW で返金の進み具合は確認できますか。' },
    a: {
      zh: '看不到。VJW 只顯示免稅店的購買紀錄和海關確認結果，退款方式有沒有登記、錢有沒有真的退回來，都不會出現。這兩段要自己記，Kaeru 就是在管這件事。',
      ja: 'できません。VJW に表示されるのは免税店の購入記録と税関確認の結果だけです。返金方法を登録したかどうか、実際に返金されたかどうかは表示されません。この 2 つは自分で管理する必要があり、それがまさに Kaeru の役目です。',
    },
  },
  {
    sec: 'exit',
    q: { zh: '什麼時候辦海關查驗？', ja: '税関確認はいつ行いますか。' },
    a: {
      zh: '託運行李之前。一旦把行李交給航空公司就拉不回來了，要提早到機場先辦完。',
      ja: '手荷物を預ける前です。一度預けた荷物は引き戻せないため、早めに空港へ。',
    },
  },
  {
    sec: 'exit',
    q: { zh: '機台在機場哪裡？', ja: '免税手続用の端末はどこにありますか。' },
    a: {
      zh: '在託運櫃檯前的國際線出發大廳一帶。',
      ja: '手荷物預け入れ前の国際線出発ロビー等に設置されます。',
    },
  },
  {
    sec: 'exit',
    q: {
      zh: '一張收據裡有東西被吃掉了，其他還能退嗎？',
      ja: 'レシートの一部を消費しました。残りは返金されますか。',
    },
    a: {
      zh: '不行。查驗以一張收據為單位，只要有一項不在身上，整張收據的商品都不能退。',
      ja: 'できません。税関確認はレシート単位のため、1 つでも所持していないと全体が対象外です。',
    },
  },
  {
    sec: 'exit',
    q: {
      zh: '衣服穿過了還能退嗎？',
      ja: '服を着てしまいましたが返金されますか。',
    },
    a: {
      zh: '可以。穿過不算消費，只要出境查驗時衣服還在、拿得出來給海關看就行。不能退的是東西已經不在的情況，像零食吃掉、化妝品用掉。',
      ja: '問題ありません。着用は消費にあたらず、確認時に所持していれば対象です。対象外になるのは、食べた・使い切ったなど所持していない場合です。',
    },
  },
  {
    sec: 'buy',
    q: {
      zh: '打算在日本吃掉的東西怎麼買比較好？',
      ja: '国内で食べるものはどう買うのがよいですか。',
    },
    a: {
      zh: '結帳時跟要帶回國的東西分開結，讓它自己一張收據。這樣就算吃掉了，也只有那張失效，其他商品不受影響。5,000 円門檻是同一間店同一天合計計算，分開結不影響達標，不過各店做法可能不同，結帳時先問店員。',
      ja: '持ち帰る物と分けて会計し、別のレシートにするのがおすすめです。消費しても影響はそのレシートだけに収まります。5,000 円の判定は同一店舗・同一日の合算なので、分けても問題ありませんが、店舗によって対応が異なる場合があるので、会計時に店員に確認してください。',
    },
  },
  {
    sec: 'exit',
    q: { zh: '買了很貴的東西要準備什麼？', ja: '高額商品には何が必要ですか。' },
    a: {
      zh: '稅抜單價滿 100 萬円的商品，海關可能要求連同商品出示鑑定書或保證書，先準備好會順很多。',
      ja: '税抜単価 100 万円以上の商品は、鑑定書や保証書の提示を求められることがあります。',
    },
  },
  {
    sec: 'exit',
    q: {
      zh: '國內線轉國際線的話在哪辦？',
      ja: '国内線から国際線に乗り継ぐ場合は。',
    },
    a: {
      zh: '在最後離開日本的那個機場辦，不是在出發的國內線機場。',
      ja: '日本を出国する最終空港で手続を行います。',
    },
  },
  {
    sec: 'refund',
    q: { zh: '什麼時候會拿到退款？', ja: '返金はいつですか。' },
    a: {
      zh: '海關查驗通過、免稅販售成立之後，由免稅店或它委託的退款業者退給你。方式各店不同，購買時要問清楚。',
      ja: '税関確認後に免税店または委託された返金事業者から返金されます。方法は店舗により異なります。',
    },
  },
  {
    sec: 'refund',
    q: { zh: '可以領現金嗎？', ja: '現金で受け取れますか。' },
    a: {
      zh: '看店家。可能是銀行匯款、信用卡、App 匯款，也可能在機場現場給現金，各店做法不一樣。',
      ja: '店舗によります。銀行振込、クレジットカード、アプリ送金、空港での現金返金などが考えられます。',
    },
  },
  {
    sec: 'refund',
    q: { zh: '沒把商品帶出境會怎樣？', ja: '商品を持ち出さなかった場合は。' },
    a: {
      zh: '會被追徵等同消費稅的金額，還會受到處分。',
      ja: '免除された消費税相当額が徴収され、罰則の適用対象になります。',
    },
  },
];

// 只留一條：加了「出境時」的 VJW 兩題之後，390×844 單頁剛好滿，其他
// 幾條小撇步（分開結帳、湊 5,000 円、集中放同一袋）跟已經有的 FAQ
// 問答重疊或另外佔位置，先拿掉。留這條是因為跟 App 本身的功能直接
// 相關，其他 FAQ 問答都沒提到。
const TIPS = [
  {
    zh: '紙本收據容易皺、容易褪色，買完順手拍照存在這個 App 裡比較保險。',
    ja: '紙のレシートは折れたり退色したりします。購入後すぐ写真を撮って保存しておくと安心です。',
  },
];

const RULES = {
  zh: [
    '結帳時付含稅價，出境查驗通過之後才退還消費稅。',
    '稅率：食品是輕減稅率 8%，酒類和外食不算，跟其他商品一樣是 10%。退的就是這筆稅額。',
    '同一間店、同一天，稅抜合計滿 5,000 円就符合，不分商品種類。',
    '海關查驗以一張收據為單位，只要有一項拿不出來，整張收據都不能退。',
    '拆開包裝、衣服穿過都沒關係。吃掉、用掉才會失效，這時候不要用機台，直接跟海關人員申報。',
    '購買日起 90 天內要出境並完成查驗。',
    '稅抜單價滿 100 萬円的商品，海關可能要求出示鑑定書或保證書。',
    '一定要在託運行李之前辦完，建議提早 3 小時到機場。',
    '機台判定綠色代表手續完成，紅色是要到海關檢查場出示商品，不是不能退。',
    '國內線轉國際線時，在最後離開日本的那個機場辦。沒把商品帶出境會被追徵消費稅並受處分。',
  ],
  ja: [
    '会計時は税込価格を支払い、出国時の税関確認後に返金されます。',
    '税率：飲食料品は軽減税率 8%。酒類と外食は対象外で、他の商品と同じ 10% です。',
    '同一店舗・同一日の税抜合計が 5,000 円以上で対象。商品の種類は問いません。',
    '税関確認はレシート単位。1 つでも所持していないと、そのレシート全体が対象外です。',
    '開封や着用は問題ありません。消費した場合は端末を使わず税関職員に申し出ます。',
    '購入日から 90 日以内に出国し、税関確認を受ける必要があります。',
    '税抜単価 100 万円以上の商品は、鑑定書や保証書の提示を求められることがあります。',
    '手荷物を預ける前に手続を終える必要があります。3 時間前の空港到着が目安です。',
    'グリーン判定は手続完了、レッド判定は税関検査場で商品を提示します。',
    '国内線から国際線へ乗り継ぐ場合は最終出国空港で手続します。持ち出さない場合は追徴と罰則の対象です。',
  ],
};

const SIM = {
  max: 15544,
  intro: {
    zh: '你在大阪待四天，最後從關西機場回台灣。手上有藥妝店的零食和面膜、服飾店的外套、電器行的相機，全部退成功可以拿回 ¥15,544。接下來九個問題，有的考規則，有的會直接影響你退到多少。',
    ja: '大阪に 4 日間滞在し、関西空港から出国します。ドラッグストアのお菓子とパック、アパレルのコート、家電量販店のカメラ。すべて成功すれば ¥15,544 戻ります。これから 9 問。ルールを問うものと、返金額に直接響くものがあります。',
  },
  wallet: {
    zh: [
      '零食 稅抜 3,800（8% → 稅 304）',
      '面膜 稅抜 2,400（10% → 稅 240）',
      '外套 稅抜 20,000（10% → 稅 2,000）',
      '相機 稅抜 130,000（10% → 稅 13,000）',
    ],
    ja: [
      'お菓子 税抜 3,800（8% → 税 304）',
      'パック 税抜 2,400（10% → 税 240）',
      'コート 税抜 20,000（10% → 税 2,000）',
      'カメラ 税抜 130,000（10% → 税 13,000）',
    ],
  },
  steps: [
    {
      where: { zh: 'Day 1 · 藥妝店', ja: '1 日目・ドラッグストア' },
      scene: {
        zh: '第一天晚上，藥妝店。你手上有稅抜 3,800 的零食和稅抜 2,400 的面膜。退稅退的是消費稅，所以先搞清楚這兩樣各被課了幾 %。',
        ja: '1 日目の夜、ドラッグストア。税抜 3,800 円のお菓子と 2,400 円のパック。返金されるのは消費税なので、まず税率を確認します。',
      },
      q: { zh: '這兩樣的消費稅率是？', ja: 'この 2 つの消費税率は。' },
      opts: [
        {
          label: { zh: '都是 10%', ja: 'どちらも 10%' },
          lose: 0,
          fb: {
            zh: '食品適用輕減稅率 8%。零食是 3,800 的 8%，也就是 304；面膜是 2,400 的 10%，也就是 240。要注意酒類和外食不算食品，一樣是 10%。',
            ja: '飲食料品は軽減税率 8% です。お菓子は 304 円、パックは 240 円。酒類と外食は対象外で 10% です。',
          },
        },
        {
          label: { zh: '零食 8%，面膜 10%', ja: 'お菓子 8%、パック 10%' },
          lose: 0,
          best: true,
          fb: {
            zh: '對。食品是輕減稅率 8%，其他商品 10%。不過酒類和外食不算在輕減稅率裡，那些是 10%。記收據的時候稅率選錯，退款金額就會算錯。',
            ja: '正解です。飲食料品は 8%、その他は 10%。酒類と外食は軽減税率の対象外で 10% です。',
          },
        },
        {
          label: { zh: '都是 8%', ja: 'どちらも 8%' },
          lose: 0,
          fb: {
            zh: '只有食品是 8%。化妝品、衣服、家電這些都是 10%，酒類和外食也是 10%。',
            ja: '8% は飲食料品のみです。化粧品・衣類・家電、そして酒類と外食は 10% です。',
          },
        },
      ],
    },
    {
      where: { zh: 'Day 1 · 藥妝店', ja: '1 日目・ドラッグストア' },
      scene: {
        zh: '兩樣加起來稅抜 6,200。免稅門檻是同一間店、同一天，稅抜合計滿 5,000 円。',
        ja: '2 つ合わせて税抜 6,200 円。免税の基準は同一店舗・同一日の税抜合計 5,000 円以上です。',
      },
      q: {
        zh: '零食和化妝品可以合併算嗎？',
        ja: 'お菓子と化粧品は合算できますか。',
      },
      opts: [
        {
          label: {
            zh: '可以，新制不分商品種類',
            ja: 'できる。新制度では種類を問わない',
          },
          lose: 0,
          best: true,
          fb: {
            zh: '對。新制取消一般品和消耗品的區分，同一間店同一天合計滿 5,000 円就符合，消耗品原本的 50 萬円上限也一起取消了。',
            ja: '正解です。一般物品と消耗品の区分が廃止され、同一店舗・同一日の合計で判定します。消耗品の 50 万円上限も撤廃されました。',
          },
        },
        {
          label: {
            zh: '不行，食品和化妝品要各自滿 5,000',
            ja: '不可。それぞれ 5,000 円必要',
          },
          lose: 0,
          fb: {
            zh: '那是舊制的做法。2026 年 11 月起取消區分，全部合併算，所以這兩樣加起來 6,200 就達標了。',
            ja: '旧制度の考え方です。2026 年 11 月からは区分が廃止され、合算して判定します。',
          },
        },
      ],
    },
    {
      where: { zh: 'Day 1 · 結帳櫃檯', ja: '1 日目・レジ' },
      scene: {
        zh: '結帳了。零食你打算今天晚上在飯店吃掉。',
        ja: '会計です。お菓子は今夜ホテルで食べるつもりです。',
      },
      q: { zh: '怎麼結？', ja: 'どう会計しますか。' },
      opts: [
        {
          label: {
            zh: '全部一起結，開一張收據',
            ja: 'まとめて会計し、レシート 1 枚にする',
          },
          lose: 544,
          fb: {
            zh: '當晚你把零食吃掉了。查驗以一張收據為單位，零食拿不出來，同一張的面膜也一起失效，¥544 全部拿不回來。',
            ja: 'その夜お菓子を食べました。税関確認はレシート単位のため、同じレシートのパックも対象外になり ¥544 を失います。',
          },
        },
        {
          label: {
            zh: '零食和面膜分開結，變成兩張收據',
            ja: '分けて会計し、レシート 2 枚にする',
          },
          lose: 304,
          best: true,
          fb: {
            zh: '當晚你把零食吃掉了，但只有零食那張失效，面膜那張不受影響，損失縮到 ¥304。門檻是同店同日合計計算，分開結不影響達標，不過各店做法可能不同，結帳時先問店員。',
            ja: 'お菓子のレシートだけが対象外になり、損失は ¥304 のみ。5,000 円の判定は合算なので分けても影響しません。',
          },
        },
        {
          label: {
            zh: '不辦免稅，直接付含稅價',
            ja: '免税手続をせず税込で買う',
          },
          lose: 544,
          fb: {
            zh: '沒登記退款方式就沒有退稅資格，這兩樣的 ¥544 直接放棄。',
            ja: '返金方法を登録しなければ対象になりません。¥544 を放棄することになります。',
          },
        },
      ],
    },
    {
      where: { zh: 'Day 3 · 電器行', ja: '3 日目・家電量販店' },
      scene: {
        zh: '第三天，電器行。你買了一台稅抜 130,000 円的相機。',
        ja: '3 日目、家電量販店。税抜 130,000 円のカメラを購入しました。',
      },
      q: {
        zh: '要不要另外準備鑑定書或保證書？',
        ja: '鑑定書や保証書は必要ですか。',
      },
      opts: [
        {
          label: {
            zh: '要，這種價位海關一定會查',
            ja: '必要。この金額なら必ず求められる',
          },
          lose: 0,
          fb: {
            zh: '不用。門檻是稅抜單價 100 萬円，13 萬還差得遠。這台不需要另外準備文件。',
            ja: '不要です。基準は税抜単価 100 万円以上です。',
          },
        },
        {
          label: {
            zh: '不用，門檻是稅抜單價 100 萬円',
            ja: '不要。基準は税抜単価 100 万円以上',
          },
          lose: 0,
          best: true,
          fb: {
            zh: '對。稅抜單價滿 100 萬円的商品，海關才可能要求連同商品出示鑑定書或保證書。',
            ja: '正解です。税抜単価 100 万円以上の商品で求められることがあります。',
          },
        },
      ],
    },
    {
      where: { zh: 'Day 3 · 飯店', ja: '3 日目・ホテル' },
      scene: {
        zh: '同行的朋友說，他半年前來日本買的東西也想這次一起辦退稅。',
        ja: '同行者が、半年前に日本で買った物も今回まとめて手続したいと言っています。',
      },
      q: { zh: '可以嗎？', ja: '可能ですか。' },
      opts: [
        {
          label: {
            zh: '可以，同一本護照就好',
            ja: '可能。同じパスポートなら問題ない',
          },
          lose: 0,
          fb: {
            zh: '不行。要在購買日起 90 天內出境並完成海關查驗，半年前的已經過期了。',
            ja: 'できません。購入日から 90 日以内の出国と税関確認が必要です。',
          },
        },
        {
          label: {
            zh: '不行，超過購買日起 90 天',
            ja: '不可。購入日から 90 日を超えている',
          },
          lose: 0,
          best: true,
          fb: {
            zh: '對。期限是購買日起 90 天內出境並完成查驗，所以買完之後別拖太久。',
            ja: '正解です。購入日から 90 日以内に出国し確認を受ける必要があります。',
          },
        },
      ],
    },
    {
      where: { zh: 'Day 4 · 出發前', ja: '4 日目・出発前' },
      scene: {
        zh: '回國當天。班機下午三點起飛，你在飯店吃完午餐。',
        ja: '帰国当日。フライトは午後 3 時です。',
      },
      q: { zh: '幾點到機場？', ja: '何時に空港へ向かいますか。' },
      opts: [
        {
          label: { zh: '一點半到，抓一個半小時', ja: '1 時半到着。1 時間半前' },
          lose: 13000,
          fb: {
            zh: '太趕了。人潮多的時候光排隊就吃掉時間，你只辦完外套那張，相機那張還沒查驗就得去登機，¥13,000 沒了。時間不夠沒趕上，航空公司和海關都不會補償。',
            ja: '時間が足りません。カメラのレシートの確認が終わらず ¥13,000 を失います。',
          },
        },
        {
          label: { zh: '十二點到，抓三個小時', ja: '12 時到着。3 時間前' },
          lose: 0,
          best: true,
          fb: {
            zh: '穩。查驗如果被判定要檢查，還得到海關檢查場出示商品，時間要抓夠。先在 VJW 登記好的話，部分機場可以線上辦，不用排機台。',
            ja: '余裕があります。VJW に登録しておくと、一部の空港ではオンライン手続ができます。',
          },
        },
      ],
    },
    {
      where: { zh: 'Day 4 · 關西機場', ja: '4 日目・関西空港' },
      scene: {
        zh: '到了關西機場，外套和相機都在行李箱裡。',
        ja: '関西空港に到着。コートとカメラはスーツケースの中です。',
      },
      q: { zh: '先做哪一件？', ja: '先にどちらをしますか。' },
      opts: [
        {
          label: {
            zh: '先去航空公司櫃檯託運，手上輕鬆一點再辦',
            ja: '先に荷物を預けてから手続する',
          },
          lose: 15000,
          fb: {
            zh: '這樣就沒了。查驗要能拿出商品，而且一旦託運就不能把行李拉回來，外套和相機的 ¥15,000 全部退不了。',
            ja: 'これで終わりです。預けた荷物は引き戻せず ¥15,000 を失います。',
          },
        },
        {
          label: {
            zh: '先在出發大廳辦完海關查驗，再去託運',
            ja: '税関確認を済ませてから預ける',
          },
          lose: 0,
          best: true,
          fb: {
            zh: '對。機台就設在託運櫃檯前的國際線出發大廳，順序不能反。',
            ja: '正解です。端末は手荷物預け入れ前の出発ロビーにあります。',
          },
        },
      ],
    },
    {
      where: { zh: 'Day 4 · 免稅手續區', ja: '4 日目・免税手続カウンター' },
      scene: {
        zh: '排到機台前，你翻出那張有零食的收據。零食第一天晚上就進肚子了。',
        ja: '端末の前で、食べてしまったお菓子のレシートを取り出しました。',
      },
      q: {
        zh: '在機場怎麼處理這張？',
        ja: '空港でこのレシートをどうしますか。',
      },
      opts: [
        {
          label: {
            zh: '照樣拿去免稅手續機台掃描',
            ja: 'そのまま端末で手続する',
          },
          lose: 0,
          penalty: {
            zh: '商品已經不在還去辦手續，等於申報不實。被查出來會被追徵消費稅，還可能受罰。',
            ja: '所持していない物品で手続すると、消費税の追徴や罰則の対象になり得ます。',
          },
          fb: {
            zh: '不能這樣做。商品已經不在了還去辦手續，屬於申報不實，被追徵消費稅之外還可能受罰。',
            ja: 'これは不可です。追徴や罰則の対象になり得ます。',
          },
        },
        {
          label: {
            zh: '不辦手續，直接跟海關人員說明',
            ja: '手続をせず税関職員に申し出る',
          },
          lose: 0,
          best: true,
          fb: {
            zh: '正確。官方寫得很清楚，消耗品全部或一部分被消費掉的時候，不要用機台辦，直接向海關人員申報。順帶一提，拆開包裝、衣服穿過都不算消費，只要東西還在就能退。',
            ja: '正解です。消費した場合は端末を使わず税関職員に申し出ます。開封や着用は消費にあたりません。',
          },
        },
      ],
    },
    {
      where: { zh: 'Day 4 · 免稅手續機台', ja: '4 日目・手続端末' },
      scene: {
        zh: '你在機台掃描護照，畫面跳出紅色判定。',
        ja: '端末でパスポートを読み取ると、レッド判定が表示されました。',
      },
      q: { zh: '接下來？', ja: '次にどうしますか。' },
      opts: [
        {
          label: {
            zh: '紅色代表不能退，直接去託運',
            ja: 'レッドは対象外。そのまま預ける',
          },
          lose: 15000,
          fb: {
            zh: '誤會了。紅色只是代表要人工檢查，不是不能退。直接走掉等於沒完成查驗，¥15,000 拿不回來。',
            ja: '誤解です。レッドは検査が必要という意味です。未完了で ¥15,000 を失います。',
          },
        },
        {
          label: {
            zh: '到海關檢查場，把商品拿出來給海關看',
            ja: '税関検査場で商品を提示する',
          },
          lose: 0,
          best: true,
          fb: {
            zh: '對。綠色代表不用檢查、手續結束；紅色是要到檢查場出示商品，檢查完一樣能退。',
            ja: '正解です。グリーンは手続完了、レッドは検査場で提示すれば問題ありません。',
          },
        },
      ],
    },
  ],
};

/* ---------------- helpers ---------------- */

const yen = (n) => new Intl.NumberFormat('ja-JP').format(Math.round(n || 0));
const twd = (n) =>
  new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 0 }).format(
    Math.round(n || 0),
  );
// 用 Math.floor 不是 Math.round——含稅金額換算稅抜金額，小數 ≥0.5 用
// 四捨五入會多算 1 円，多筆商品加總後剛好卡在 5,000 円門檻邊界的組合，
// 可能因為這 1-2 円的捨入差異被判定成「達標」或「未達標」，跟店家
// 收銀機實際算出來的稅抜合計不一致。日本收銀機算稅抜金額慣例本來就是
// 捨去小數，不是四捨五入，改成 floor 更貼近實際情況。
export const netOf = (incl, rate) =>
  Math.floor((incl || 0) / (1 + (rate || 10) / 100));
/* 混合稅率（8% 對象／10% 對象各一筆）：稅抜合計 = 兩段各自試算後相加，不是拿含稅總額套單一稅率 */
export const netOfItem = (it) =>
  it.rate === 'mixed'
    ? netOf(it.incl8 || 0, 8) + netOf(it.incl10 || 0, 10)
    : netOf(it.incl, it.rate);
// 故意不用 toISOString()——那個是 UTC 日期，在台灣/日本這種 UTC+8/+9
// 的時區，每天凌晨到早上這段時間會被算成「昨天」，直接影響新增收據
// 預設的購買日期跟 90 天期限起算點。用 getFullYear/Month/Date 拿本機
// 時區的日期。
const todayStr = () => {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
};
const groupKey = (it) => `${(it.shop || '').trim()}||${it.date}`;

export function daysLeft(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr + 'T00:00:00');
  // 只檢查 dateStr 是不是空字串不夠——資料匯入或損毀時，日期欄位可能
  // 不是空的，但格式不對，new Date() 會產生 Invalid Date，後面的運算
  // 會一路是 NaN，畫面上顯示「NaN 天」而不是安全地當作沒有日期。
  if (isNaN(d.getTime())) return null;
  d.setDate(d.getDate() + 90);
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return Math.round((d - now) / 86400000);
}

// 待補：店名是空的，或金額還沒填（incl 是 0／未設）——兩個都用「資料
// 本身長什麼樣」這個天然訊號判斷，不用另外開欄位去記「這張是不是待
// 補」。店名待補是原本就有的規則：完整表單本來就規定店名必填，正常
// 流程不會存出空店名的收據，所以這個判斷不會誤判到既有資料。金額待補
// 是後來加的：快速新增現在容許「只有照片、金額晚點補」也能存（見
// QuickAddFlow），這種收據存進來時 incl 就是 0，跟已經填好金額的收據
// 用同一個「incl 是不是 0」訊號分開，一旦補上金額，這張自動不再是
// 待補狀態。兩者都待補、只有其中一個待補，都算待補——這張收據還不能
// 拿去算帳（分組、門檻判定、預估可退稅額），只要有一項沒填就是。
export function isPendingInfo(it) {
  return !it.shop || !it.shop.trim() || !it.incl;
}

// 已經超過 90 天期限、還沒真的退到錢、也不是已在境內消費（那個是另一
// 種「死掉」，有自己的樣式跟文案）的收據——跟「已在境內消費」用同一套
// 對待方式：不刪除、不隱藏，但不再算進「還沒處理」或「預估可退稅額」，
// 因為那筆錢已經拿不回來了，算進去只會讓使用者以為還有機會。
export function isExpiredUnclaimed(it) {
  // 「已查驗」（verified）跟這個 app 其他地方的既有慣例一樣，要當成
  // 錢已經到手——只排除 'refunded' 不夠，會讓已經查驗過、只是還沒
  // 手動標「已退款」的收據，一旦超過 90 天就被誤判成「來不及、拿不
  // 回來」，從 refundedTax 消失，又同時被算進「還沒處理」跳期限
  // 警示，兩邊自相矛盾。
  if (it.status === 'refunded' || it.status === 'verified' || it.consumed)
    return false;
  const d = daysLeft(it.date);
  return d !== null && d < 0;
}

// 首頁倒數（幾天幾小時）本身沒有 setInterval，dDays/dHours 只有在畫面
// 因為別的原因重新 render 時才會跟著重算一次——使用者把首頁開著不動，
// 倒數會停在打開那一刻，不會自然往下跳。這個 hook 每分鐘強迫重新
// render 一次，讓倒數自己會動；小時以下的精細度用不到，一分鐘夠了。
function useNowTick(intervalMs = 60000) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
}

function compressImage(file, maxSide = 1000, quality = 0.6) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      compressImageSrc(reader.result, maxSide, quality).then(resolve, reject);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// 跟 compressImage 一樣的縮圖／壓縮邏輯，但吃任意可載入的圖片來源
// （dataURL、blob URL、Capacitor 的 webPath...），相簿多選跟掃描結果都靠這個。
function compressImageSrc(src, maxSide = 1000, quality = 0.6) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(img.width * scale));
      c.height = Math.max(1, Math.round(img.height * scale));
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      resolve(c.toDataURL('image/jpeg', quality));
    };
    img.onerror = reject;
    // 這裡曾經設 img.crossOrigin = 'anonymous'——那是為了避免畫到
    // canvas 上的圖是「真的跨來源」時 toDataURL 被瀏覽器擋掉
    // （tainted canvas）。但這個函式實際餵進來的來源只有兩種：data:
    // URL（FileReader/掃描結果，本來就不算跨來源）跟 Capacitor 原生端
    // 給的本機檔案路徑（相簿/相機的 webPath、uri）——後者對 WebView
    // 來說本來就算同來源，設了 crossOrigin 反而可能讓某些機型/WebView
    // 版本直接讀取失敗（onerror 被觸發），這個函式的呼叫端（相簿多選
    // 時「第一張以外」的照片、OCR 前置轉檔）都用 try/catch 靜默吞掉
    // 失敗，使用者只會發現「選了 3 張卻只存進 2 張」，完全看不出原因。
    // 拿掉這行——目前所有呼叫情境都不需要它，只有壞處沒有好處。
    img.src = src;
  });
}

// 4 角透視校正：把來源影像中一個（可能歪斜的）四邊形裁出來拉正成矩形。
// 做法是把四邊形切成兩個三角形，各自求出對應輸出三角形的仿射矩陣，
// clip 之後用該矩陣畫整張圖——標準的「canvas 三角貼圖」技巧，不需要 WebGL。
function solveAffine(src3, dst3) {
  // 解兩個共用係數矩陣的 3x3 線性方程式（x 分量、y 分量分別求）
  const [[x0, y0], [x1, y1], [x2, y2]] = src3;
  const det =
    x0 * (y1 - y2) - y0 * (x1 - x2) + (x1 * y2 - x2 * y1);
  if (Math.abs(det) < 1e-6) return null;
  const solveFor = (X0, X1, X2) => {
    // Cramer's rule：a*x+c*y+e=X 對三個點列聯立
    const a =
      (X0 * (y1 - y2) - y0 * (X1 - X2) + (X1 * y2 - X2 * y1)) / det;
    const c =
      (x0 * (X1 - X2) - X0 * (x1 - x2) + (x1 * X2 - x2 * X1)) / det;
    const e =
      (x0 * (y1 * X2 - y2 * X1) -
        y0 * (x1 * X2 - x2 * X1) +
        X0 * (x1 * y2 - x2 * y1)) /
      det;
    return [a, c, e];
  };
  const [a, c, e] = solveFor(dst3[0][0], dst3[1][0], dst3[2][0]);
  const [b, d, f] = solveFor(dst3[0][1], dst3[1][1], dst3[2][1]);
  return [a, b, c, d, e, f];
}

function perspectiveCrop(img, corners, outW, outH) {
  // corners: [TL, TR, BR, BL]，每個是 {x,y}（原圖像素座標）
  const [TL, TR, BR, BL] = corners;
  const c = document.createElement('canvas');
  c.width = outW;
  c.height = outH;
  const ctx = c.getContext('2d');
  const tris = [
    { src: [TL, TR, BL], dst: [[0, 0], [outW, 0], [0, outH]] },
    { src: [TR, BR, BL], dst: [[outW, 0], [outW, outH], [0, outH]] },
  ];
  for (const tri of tris) {
    const m = solveAffine(
      tri.src.map((p) => [p.x, p.y]),
      tri.dst,
    );
    if (!m) continue;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(tri.dst[0][0], tri.dst[0][1]);
    ctx.lineTo(tri.dst[1][0], tri.dst[1][1]);
    ctx.lineTo(tri.dst[2][0], tri.dst[2][1]);
    ctx.closePath();
    ctx.clip();
    ctx.transform(m[0], m[1], m[2], m[3], m[4], m[5]);
    ctx.drawImage(img, 0, 0);
    ctx.restore();
  }
  return c;
}

function rotateCanvas(src, deg) {
  if (!deg) return src;
  const swapped = deg === 90 || deg === 270;
  const c = document.createElement('canvas');
  c.width = swapped ? src.height : src.width;
  c.height = swapped ? src.width : src.height;
  const ctx = c.getContext('2d');
  ctx.translate(c.width / 2, c.height / 2);
  ctx.rotate((deg * Math.PI) / 180);
  ctx.drawImage(src, -src.width / 2, -src.height / 2);
  return c;
}

// 放大檢視的「旋轉」要真的改到存起來的照片，不是只轉螢幕上的畫面，
// 不然關掉再打開又轉回去，使用者會覺得沒生效。
function rotateImageSrc(src, deg) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      c.getContext('2d').drawImage(img, 0, 0);
      const rotated = rotateCanvas(c, deg);
      resolve(rotated.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = reject;
    img.src = src;
  });
}

function applyContrast(canvas, amount = 35) {
  const ctx = canvas.getContext('2d');
  const { width: w, height: h } = canvas;
  const id = ctx.getImageData(0, 0, w, h);
  const d = id.data;
  const factor = (259 * (amount + 255)) / (255 * (259 - amount));
  const clamp = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);
  for (let i = 0; i < d.length; i += 4) {
    d[i] = clamp(factor * (d[i] - 128) + 128);
    d[i + 1] = clamp(factor * (d[i + 1] - 128) + 128);
    d[i + 2] = clamp(factor * (d[i + 2] - 128) + 128);
  }
  ctx.putImageData(id, 0, 0);
  return canvas;
}

// 從 OCR 辨識出的原始文字，抓「N%対象 金額円」這種日本收據固定格式。
// 找不到任何 %対象 就整個回傳 null——OCR 是省打字，不是猜答案，讀不到不要生數字。
// 把 OCR 回傳的每一行文字（各自帶座標）依垂直位置分組成「同一橫排」，
// 橫排內再依水平位置從左到右排好，重新拼出跟收據實際排版一致的閱讀
// 順序。原生端（ML Kit／Vision）是照它們自己切出來的文字區塊順序回傳
// 整份文字，遇到「左邊一整欄標籤、右邊一整欄金額」這種排版，常常會把
// 兩欄各自切成不同區塊，回傳順序變成「標籤全部先列完，金額才接著
// 列」，跟標籤金額原本的左右對應關係整個脫節——只給文字本身救不回來，
// 要靠座標重新配對。座標單位（像素或 0–1 正規化）兩邊平台不一樣，但
// 這裡只在同一次呼叫回來的資料裡互相比較相對位置，不需要統一單位。
export function reconstructRowsFromLines(lines) {
  if (!lines || !lines.length) return '';
  const items = lines
    .filter((l) => l && typeof l.text === 'string' && l.text.trim())
    .map((l) => ({
      text: l.text,
      top: Number(l.top) || 0,
      left: Number(l.left) || 0,
      bottom: Number(l.bottom) || 0,
      right: Number(l.right) || 0,
    }));
  if (!items.length) return '';
  items.sort((a, b) => a.top + a.bottom - (b.top + b.bottom));

  const rows = [];
  for (const item of items) {
    const height = Math.max(1, item.bottom - item.top);
    // 跟現有的每一排比，垂直範圍重疊超過這一行高度一半，就當作同一排
    // ——收據上左右兩欄、同一橫排的文字，高度通常差不多。
    let row = rows.find((r) => {
      const overlap = Math.min(r.bottom, item.bottom) - Math.max(r.top, item.top);
      return overlap > Math.min(r.bottom - r.top, height) * 0.5;
    });
    if (!row) {
      row = { top: item.top, bottom: item.bottom, items: [] };
      rows.push(row);
    }
    row.top = Math.min(row.top, item.top);
    row.bottom = Math.max(row.bottom, item.bottom);
    row.items.push(item);
  }
  rows.sort((a, b) => a.top + a.bottom - (b.top + b.bottom));
  return rows
    .map((r) =>
      r.items
        .sort((a, b) => a.left - b.left)
        .map((i) => i.text)
        .join(' '),
    )
    .join('\n');
}

export function parseReceiptOCR(text) {
  if (!text) return null;
  const norm = text.replace(/[，]/g, ',');
  const pctRe = /(8|10)\s*%\s*(?:対象|對象)[^\d]{0,12}([\d,]{2,9})\s*円/g;
  const found = {};
  let m;
  while ((m = pctRe.exec(norm))) {
    const amt = Number(m[2].replace(/,/g, ''));
    // 同一個稅率只認第一筆比對到的，後面重複的不要蓋掉。日本收據常見
    // 格式是「10%對象 1,000円」後面接一行「（內消費稅等 100円）」——
    // 後面那行也符合這個規則（"對象" 跟數字之間允許到 12 個非數字字
    // 元，"內消費稅等　" 剛好塞得進去），如果用蓋掉的方式，含稅小計
    // 會被內消費稅那個小數字取代，金額直接少一個位數；用累加的話反而
    // 會把稅額誤加回小計，一樣是錯的。第一筆抓到的通常就是真正的小計
    // 金額，後面重複比對到的不管，才是兩種收據格式都對的做法。
    if (amt > 0 && !(m[1] in found)) found[m[1]] = amt;
  }
  const rates = Object.keys(found);

  const result = {};
  if (rates.length >= 2) {
    result.rate = 'mixed';
    result.incl8 = found['8'] || null;
    result.incl10 = found['10'] || null;
  } else if (rates.length === 1) {
    result.rate = Number(rates[0]);
    result.incl = found[rates[0]];
  } else {
    // 讀不到「N%對象」這種便利商店/藥妝店式標籤——不是所有收據都會
    // 印稅率明細，退而求其次找「合計/お会計/總額」這種一般收銀機常見
    // 的總額標籤+金額，當作含稅總額，稅率不知道所以先預設 10%（較常
    // 見），存進表單後使用者自己確認調整；「合計」要排除掉「合計点數」
    // 這種列商品件數、不是列金額的行，不然會把件數誤當金額抓進來。
    // 這兩種格式都找不到，金額就先不填，但不要整個放棄——店名跟日期
    // 是完全獨立的規則，不需要靠金額才能抓，下面繼續往下走。
    //
    // 這裡曾經吃過一個虧：OCR 偶爾會把「¥」符號本身誤讀成別的字元，
    // 而且不一定是誤讀成非數字字元（那樣還好，反正間隔比對會跳過）
    // ——實測遇過直接誤讀成數字「4」，緊貼在真正金額前面，跟間隔比對
    // 允許的「任何非數字字元」混在一起，被整段吃進金額，讀出一個多一
    // 位數、完全錯誤的天文數字（「¥21,800」被讀成「421,800」）。要擋
    // 掉這個誤讀，不能只是放寬或縮窄間隔字元數，得真的比對到「¥/￥」
    // 這個符號本身才算數——如果 OCR 把 ¥ 讀壞了，寧可整條不比對成功，
    // 讀不到總比讀錯安全。這裡拆成兩種收據慣例分別處理，互不影響：
    //   1) 標籤後面直接接「¥金額」、沒有「円」字尾——一定要抓到真正
    //      的 ¥/￥ 符號才算數。
    //   2) 標籤後面接「金額円」、沒有 ¥ 符號——這種格式本來就沒有 ¥
    //      符號可以誤讀，維持原本寬鬆的間隔比對就好。
    const totalLabel = '(?:合計(?!點數|点数)|お会計|ご請求金額|總額|総額)';
    const yenPrefixRe = new RegExp(`${totalLabel}[^\\d¥￥]{0,8}[¥￥]\\s*([\\d,]{2,9})`);
    const yenSuffixRe = new RegExp(`${totalLabel}[^\\d]{0,8}([\\d,]{2,9})\\s*円`);
    const totalMatch = norm.match(yenPrefixRe) || norm.match(yenSuffixRe);
    const amt = totalMatch ? Number(totalMatch[1].replace(/,/g, '')) : 0;
    if (amt > 0) {
      result.rate = 10;
      result.incl = amt;
    }
  }

  const lines = norm
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const shopLine = lines.find((l) => l.length >= 2 && l.length <= 20 && !/\d/.test(l));
  if (shopLine) result.shop = shopLine;

  const dm = norm.match(/(20\d{2})[\-\/年](\d{1,2})[\-\/月](\d{1,2})/);
  if (dm) {
    result.date = `${dm[1]}-${String(dm[2]).padStart(2, '0')}-${String(dm[3]).padStart(2, '0')}`;
  }

  // 金額、店名、日期三個一個都沒抓到，這次辨識才算真的沒有用——回傳
  // null 讓呼叫端知道「讀不到」跟「有讀到、只是要手動補齊」是不同的
  // 兩件事。只要有抓到其中一項，就把抓到的部分帶回去，不要因為金額
  // 沒抓到就連店名/日期一起浪費掉。
  if (!result.incl && !result.incl8 && !result.incl10 && !result.shop && !result.date) {
    return null;
  }
  return result;
}

// 判斷「這張看起來像不像收據」，只用來決定要不要跳「不像收據」那個
// 分支（見 QuickAddFlow），故意做得很粗——不是要精準分類，是要抓出
// 「這張顯然不是收據」的明顯案例（例如拍到的是買到的東西本身），同時
// 放過「這是收據、只是角度/光線不好，OCR 結構化解析失敗」的情況，讓
// 那種情況照舊走「讀不到，手動補」那條路，不要被誤導去問使用者「這是
// 不是收據」。
//
// 這裡原本只看「有沒有連續 3 個數字＋至少 2 行字」，太寬鬆——任何隨機
// 數字（電話號碼、ID、時間戳、螢幕解析度）只要湊到 3 位數就會誤判成
// 「像收據」。實測踩到兩次：一次拍桌面截圖，某個視窗標題剛好有數字；
// 一次拍到螢幕上顯示的除錯 log，log 裡一段呼叫序號（9 位數）就把整
// 張誤判成收據，導致明明不是收據卻沒有跳出「不像收據」畫面。改成看
// 「數字旁邊有沒有金額符號（円/¥/%）」——這是收據排版特有的訊號，隨機
// 文字裡的數字不會剛好緊貼著這些符號；退一步再看有沒有「合計/対象」
// 這類收據關鍵字（防住標籤跟金額被 OCR 拆到不同行、抓不到緊貼符號的
// 情況）。兩個條件都沒有，才夠格說「不像收據」。
export function looksLikeReceiptText(text) {
  if (!text) return false;
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length < 2) return false;
  const hasCurrencyNumber =
    /\d[\d,]*\s*(?:円|¥|￥|%|％)/.test(text) || /(?:¥|￥)\s*[\d,]*\d/.test(text);
  const hasReceiptKeyword = /(合計|対象|對象|お会計|レシート|receipt|小計|總額|総額)/i.test(
    text,
  );
  return hasCurrencyNumber || hasReceiptKeyword;
}

// 幫「這張新照片預設要標成收據還是物品」猜一個型別——只有 QuickAddFlow
// 第一張照片會走完整的「不像收據」互動分支，其他所有加照片的地方
// （選相簿多選時第一張以外的照片、詳情頁/完整表單的「+加照片」）新
// 照片本來一律硬寫死當「收據照片」，完全沒有用到 OCR 內容去判斷——
// 實測過：食物、飲料、店面這種明顯不是收據的照片，一樣被歸類成收據
// 照片，使用者才會覺得「怎�麼都跑到收據那邊」。這裡跟 PhotoConfirmSheet
// 用同一套判斷（重組成閱讀順序、看像不像收據），只是拿掉裁切/使用者
// 互動那一段，純粹用來猜一個比「全部都當收據」合理的預設值——猜錯的話
// 使用者長按縮圖還是能改，不是最終定案。
export async function guessPhotoType(b64Src) {
  try {
    const res = await ReceiptScanner.recognizeText({ image: b64Src });
    const reconstructed = res?.lines?.length ? reconstructRowsFromLines(res.lines) : '';
    const forParse = reconstructed || res?.text || '';
    return looksLikeReceiptText(forParse) ? 'receipt' : 'item';
  } catch (err) {
    // 辨識本身失敗（權限、原生端出錯）跟「真的不像收據」是不一樣的
    // 兩件事，沒有任何文字可以判斷時，寧可維持原本「當收據」的預設，
    // 不要因為辨識失敗就把一張可能真的是收據的照片誤標成物品照片。
    return 'receipt';
  }
}

/* ---------------- primitives ---------------- */

function FrogMark({ size = 30, color = C.sage, bg = C.page }) {
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

function Badge({ tone = 'line', size = 'md', children }) {
  const map = {
    line: { bg: C.soft, fg: C.sub },
    clay: { bg: C.clay, fg: '#FFFFFF' },
    sage: { bg: C.sage, fg: '#FFFFFF' },
    blue: { bg: C.blue, fg: '#FFFFFF' },
    outline: { bg: 'transparent', fg: C.sub, bd: C.line },
    mute: { bg: 'transparent', fg: C.sub, bd: C.sub },
  };
  const s = map[tone];
  const outlineLike = tone === 'outline' || tone === 'mute';
  const padding =
    size === 'lg' ? '4px 8px' : outlineLike ? '2px 6px' : '3px 7px';
  const fontSize = size === 'lg' ? '10.5px' : '10px';
  return (
    <span
      className="inline-flex items-center gap-1 font-semibold"
      style={{
        backgroundColor: s.bg,
        color: s.fg,
        fontSize,
        padding,
        borderRadius: '3px',
        border: s.bd ? `1px solid ${s.bd}` : '1px solid transparent',
      }}
    >
      {children}
    </span>
  );
}

/* 票券：四方角、細框、上緣虛線裁切 */
/* 一組（同店同日）收據共用一個外框，票券感只靠內部虛線分隔——見 ListView 的呼叫方式 */
function Ticket({ children, tone = 'normal', onClick, separator }) {
  const bg = tone === 'dead' ? C.soft : '#FFFFFF';
  const El = onClick ? 'button' : 'div';
  return (
    <El
      onClick={onClick}
      className="relative block w-full px-3.5 pb-3.5 pt-3 text-left"
      style={{
        backgroundColor: bg,
        borderTop: separator ? `1px dashed ${C.line}` : 'none',
        borderRadius: 0,
      }}
    >
      {children}
    </El>
  );
}

function Field({ label, hint, children, as: As = 'label' }) {
  return (
    <As className="block">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <span
          className="font-bold"
          style={{ color: C.blue, fontSize: '10.5px', letterSpacing: '0.22em' }}
        >
          {label}
        </span>
        {hint && (
          <span className="text-xs" style={{ color: C.sub }}>
            {hint}
          </span>
        )}
      </div>
      {children}
    </As>
  );
}

/* 底線式輸入：無框、無底色，focus 時底線轉 ink（見 App 頂層的 .jp-underline 樣式） */
function Input(props) {
  return (
    <input
      {...props}
      className="jp-underline w-full bg-transparent outline-none"
      style={{
        border: 'none',
        borderBottom: `1px solid ${C.line}`,
        color: C.ink,
        padding: '0 0 10px',
        fontSize: '16px',
      }}
    />
  );
}

function Card({ children, style, ...rest }) {
  return (
    <div
      {...rest}
      className={`py-4 ${rest.className || ''}`}
      style={{ borderTop: `1px solid ${C.line}`, ...style }}
    >
      {children}
    </div>
  );
}

function Toggle({ checked, onChange, label, hint, warn }) {
  const on = checked;
  const bg = warn ? (on ? C.claySoft : '#FFFFFF') : on ? C.blueSoft : '#FFFFFF';
  const bd = warn ? C.clay : on ? C.blue : C.line;
  const fg = warn ? C.clayInk : on ? C.blueDeep : C.ink;
  return (
    <button
      onClick={() => onChange(!checked)}
      className="flex w-full items-center justify-between gap-3 text-left"
      style={{
        backgroundColor: bg,
        border: `1px solid ${bd}`,
        borderRadius: 0,
        padding: '13px 14px',
      }}
    >
      <span>
        <span className="block" style={{ color: fg, fontSize: '15px' }}>
          {label}
        </span>
        {hint && (
          <span className="mt-0.5 block text-xs" style={{ color: C.sub }}>
            {hint}
          </span>
        )}
      </span>
      <span
        className="relative shrink-0"
        style={{
          width: '34px',
          height: '18px',
          backgroundColor: on ? (warn ? C.clay : C.blue) : C.line,
          borderRadius: 0,
        }}
      >
        <span
          className="absolute transition-transform"
          style={{
            top: '2px',
            left: '2px',
            width: '14px',
            height: '14px',
            backgroundColor: '#FFFFFF',
            transform: on ? 'translateX(16px)' : 'translateX(0)',
          }}
        />
      </span>
    </button>
  );
}

function StageRail({ status, t }) {
  const idx = STAGES.indexOf(status);
  return (
    <div className="flex items-center gap-1.5">
      {STAGES.map((s, i) => (
        <div key={s} className="flex items-center gap-1.5">
          <div
            className="h-1.5 w-1.5 rounded-full"
            style={{ backgroundColor: i <= idx ? C.blue : C.line }}
          />
          {i < STAGES.length - 1 && (
            <div
              className="h-px w-4"
              style={{ backgroundColor: i < idx ? C.blue : C.line }}
            />
          )}
        </div>
      ))}
      <span className="ml-1 text-xs" style={{ color: C.sub }}>
        {t.stage[status]}
      </span>
    </div>
  );
}

function Notice({ tone = 'clay', children }) {
  const s =
    tone === 'clay'
      ? { bg: C.claySoft, fg: C.clayInk }
      : { bg: C.blueSoft, fg: C.blueDeep };
  return (
    <p
      className="flex gap-2 rounded-xl p-3 text-xs leading-relaxed"
      style={{ backgroundColor: s.bg, color: s.fg }}
    >
      <AlertTriangle size={15} className="mt-0.5 shrink-0" />
      <span>{children}</span>
    </p>
  );
}

/* ---------------- date picker ---------------- */

const pad2 = (n) => String(n).padStart(2, '0');
const dateOf = (v) => (v ? v.slice(0, 10) : '');
const timeOf = (v) => (v && v.length >= 16 ? v.slice(11, 16) : '');

function Calendar({ value, onPick, t }) {
  const seed = value ? new Date(dateOf(value) + 'T00:00:00') : new Date();
  const [view, setView] = useState(
    new Date(seed.getFullYear(), seed.getMonth(), 1),
  );

  const y = view.getFullYear();
  const m = view.getMonth();
  const first = new Date(y, m, 1).getDay();
  const total = new Date(y, m + 1, 0).getDate();
  const selected = dateOf(value);
  const today = todayStr();

  const cells = [];
  for (let i = 0; i < first; i++) cells.push(null);
  for (let d = 1; d <= total; d++) cells.push(d);

  const shift = (n) => setView(new Date(y, m + n, 1));

  return (
    <div>
      <div className="flex items-center justify-between">
        <button
          onClick={() => shift(-1)}
          className="rounded-lg p-1.5"
          style={{ color: C.sub }}
        >
          <ChevronLeft size={16} />
        </button>
        <span className="text-sm font-bold tabular-nums">
          {y} / {pad2(m + 1)}
        </span>
        <button
          onClick={() => shift(1)}
          className="rounded-lg p-1.5"
          style={{ color: C.sub }}
        >
          <ChevronRight size={16} />
        </button>
      </div>

      <div className="mt-3 grid grid-cols-7 gap-y-1">
        {t.weekdays.map((w, i) => (
          <span
            key={i}
            className="pb-1 text-center text-xs"
            style={{ color: C.sub }}
          >
            {w}
          </span>
        ))}
        {cells.map((d, i) => {
          if (d === null) return <span key={i} />;
          const iso = `${y}-${pad2(m + 1)}-${pad2(d)}`;
          const on = iso === selected;
          const isToday = iso === today;
          return (
            <button
              key={i}
              onClick={() => onPick(iso)}
              className="mx-auto flex h-8 w-8 items-center justify-center rounded-full text-sm tabular-nums"
              style={{
                backgroundColor: on ? C.blue : 'transparent',
                color: on ? '#FFFFFF' : C.ink,
                border:
                  !on && isToday
                    ? `1px solid ${C.blue}`
                    : '1px solid transparent',
              }}
            >
              {d}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function TimeRow({ value, onChange, t }) {
  const [hh, mm] = (value || '00:00').split(':');
  const sel = {
    backgroundColor: '#FFFFFF',
    border: `1px solid ${C.line}`,
    color: C.ink,
    fontFamily: 'inherit',
  };
  return (
    <div
      className="mt-4 flex items-center gap-2"
      style={{ borderTop: `1px solid ${C.line}`, paddingTop: '1rem' }}
    >
      <span className="text-xs" style={{ color: C.sub }}>
        {t.time}
      </span>
      <select
        value={hh}
        onChange={(e) => onChange(`${e.target.value}:${mm}`)}
        className="rounded-lg px-2 py-1.5 text-sm tabular-nums outline-none"
        style={sel}
      >
        {Array.from({ length: 24 }, (_, i) => pad2(i)).map((h) => (
          <option key={h} value={h}>
            {h}
          </option>
        ))}
      </select>
      <span style={{ color: C.sub }}>:</span>
      <select
        value={mm}
        onChange={(e) => onChange(`${hh}:${e.target.value}`)}
        className="rounded-lg px-2 py-1.5 text-sm tabular-nums outline-none"
        style={sel}
      >
        {Array.from({ length: 12 }, (_, i) => pad2(i * 5)).map((x) => (
          <option key={x} value={x}>
            {x}
          </option>
        ))}
      </select>
    </div>
  );
}

function DateField({ value, onChange, t, withTime, fontSize = '16px' }) {
  const [open, setOpen] = useState(false);
  const label = value
    ? withTime
      ? `${dateOf(value).replace(/-/g, '/')}  ${timeOf(value) || '00:00'}`
      : dateOf(value).replace(/-/g, '/')
    : withTime
      ? t.pickDateTime
      : t.pickDate;

  const set = (d, tm) => {
    if (!d) return onChange('');
    onChange(withTime ? `${d}T${tm || timeOf(value) || '00:00'}` : d);
  };

  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between pb-2.5 text-left"
        style={{
          borderBottom: `1px solid ${open ? C.ink : C.line}`,
          color: value ? C.ink : C.sub,
        }}
      >
        <span className="font-semibold tabular-nums" style={{ fontSize }}>
          {label}
        </span>
        <CalIcon size={16} style={{ color: C.sub }} />
      </button>

      {open && (
        <div
          className="mt-2 p-3.5"
          style={{
            backgroundColor: C.soft,
            border: `1px solid ${C.line}`,
            borderRadius: 0,
          }}
        >
          <Calendar value={value} onPick={(d) => set(d)} t={t} />
          {withTime && (
            <TimeRow
              value={timeOf(value) || '00:00'}
              onChange={(tm) => set(dateOf(value) || todayStr(), tm)}
              t={t}
            />
          )}
          <div className="mt-4 flex gap-2">
            <button
              onClick={() => set(todayStr())}
              className="flex-1 py-2 text-xs"
              style={{
                border: `1px solid ${C.line}`,
                color: C.ink,
                backgroundColor: '#FFFFFF',
                borderRadius: 0,
              }}
            >
              {t.today}
            </button>
            <button
              onClick={() => onChange('')}
              className="flex-1 py-2 text-xs"
              style={{
                border: `1px solid ${C.line}`,
                color: C.sub,
                backgroundColor: '#FFFFFF',
                borderRadius: 0,
              }}
            >
              {t.clearDate}
            </button>
            <button
              onClick={() => setOpen(false)}
              className="flex-1 py-2 text-xs font-medium"
              style={{
                backgroundColor: C.blue,
                color: '#FFFFFF',
                borderRadius: 0,
              }}
            >
              {t.doneDate}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------------- app ---------------- */

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
        /* RWD：單欄置中，320–480 隨欄寬，480 以上鎖寬只加留白，<390 整體等比縮放 */
        .kaeru-app{width:100%;max-width:480px;margin-inline:auto;min-height:100dvh;display:flex;flex-direction:column}
        @media (min-width:768px){.kaeru-app{border-left:1px solid ${C.line};border-right:1px solid ${C.line}}}
        @media (max-width:389.98px){.kaeru-app{width:390px;zoom:calc(100vw / 390)}}
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

/* ---------------- views ---------------- */

function HomeView({
  t,
  stats,
  settings,
  trip,
  hasItems,
  itemCount,
  onAdd,
  onGoSettings,
  onGoList,
  onGoCheck,
  onEditTrip,
  onGoFaq,
  onStartSim,
}) {
  useNowTick();
  const dep = trip && trip.departure ? new Date(trip.departure) : null;
  const diffMs = dep ? dep - new Date() : null;
  const dDays = diffMs !== null ? Math.floor(diffMs / 86400000) : null;
  const dHours =
    diffMs !== null ? Math.floor((diffMs % 86400000) / 3600000) : null;
  const airport = trip && trip.airport ? AIRPORTS.find((a) => a.code === trip.airport) : null;
  const arriveBuffer = airport ? airport.hours : DEFAULT_ARRIVE_HOURS;
  const arriveBy = dep ? new Date(dep.getTime() - arriveBuffer * 3600000) : null;
  const fmt = (d) =>
    d
      ? `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
      : '';
  const departed = !!dep && diffMs <= 0;
  // 回程當天行動列：只在起飛前 24 小時內出現，其他時候完全不存在——
  // 不要用 disabled 或灰掉的版本佔位，沒到那個時間點就當它不存在。
  const within24h = !!dep && diffMs !== null && diffMs > 0 && diffMs <= 24 * 3600 * 1000;

  // 還沒有任何一張收據：先讓「行程」這個概念被看見，而不是悄悄疊在
  // 匿名行程裡。有沒有名字／回程時間決定看到畫面 38 還是畫面 39。
  if (!hasItems) {
    const unnamed = !trip || !trip.name || !trip.departure;
    return unnamed ? (
      <EmptyUnnamedTrip
        t={t}
        trip={trip}
        onEditTrip={onEditTrip}
        onAdd={onAdd}
        onStartSim={onStartSim}
      />
    ) : (
      <EmptyNamedTrip
        t={t}
        trip={trip}
        onAdd={onAdd}
        onGoFaq={onGoFaq}
        onGoSettings={onGoSettings}
      />
    );
  }

  return (
    <div className="space-y-10 pb-6">
      <section className="pt-2">
        {dep ? (
          <CountdownDisplay
            t={t}
            dep={dep}
            diffMs={diffMs}
            dDays={dDays}
            dHours={dHours}
            departed={departed}
            onGoSettings={onGoSettings}
          />
        ) : (
          // 缺口，不是隱藏——藏起來就沒人知道少了什麼。原本 52px 倒數
          // 的位置換成這塊虛線缺口，段標位置跟正常倒數對得起來，讓使用
          // 者一看就知道「這裡本來該有東西」。見
          // CLAUDE_CODE_DELTA_未設定回程時間.md 第 1 節。
          <div style={{ border: `1px dashed ${C.clay}`, padding: '16px' }}>
            <p style={{ color: C.sub, fontSize: '10.5px', letterSpacing: '0.24em' }}>
              {t.departIn}
            </p>
            <p className="mt-2 font-bold" style={{ fontSize: '19px', color: C.ink }}>
              {t.noDepartureTitle}
            </p>
            <p className="mt-2" style={{ fontSize: '13px', color: C.sub, lineHeight: 1.75 }}>
              {t.noDepartureDesc}
            </p>
            <div className="mt-4 flex gap-1.5">
              <button
                onClick={onEditTrip}
                className="font-semibold"
                style={{ flex: 1, padding: '12px 0', backgroundColor: C.blue, color: '#FFFFFF' }}
              >
                {t.setDepartureCta}
              </button>
              {/* 「晚點」故意不接任何動作——這塊缺口是持續存在的提示，
                  不是一次性的 toast，不需要「關閉」或「稍後提醒」這種
                  狀態；點了就是單純承認「現在不想填」，畫面維持原樣，
                  缺口會一直留到使用者自己填了回程時間才消失。 */}
              <button
                className="font-semibold"
                style={{ padding: '12px 18px', border: `1px solid ${C.line}`, color: C.ink }}
              >
                {t.laterCta}
              </button>
            </div>
          </div>
        )}
        {dep && diffMs > 0 && !within24h && (
          <div className="mt-4 flex flex-wrap gap-1.5">
            <Badge tone="blue">
              {t.arriveTagPre}
              {fmt(arriveBy)}
              {t.arriveTagSuf}
            </Badge>
            <Badge tone="clay">{t.checkinBadge}</Badge>
          </div>
        )}

        {within24h && (
          <button
            onClick={onGoCheck}
            className="mt-4 flex w-full items-center justify-between gap-3 text-left"
            style={{
              backgroundColor: stats.todoCount > 0 ? C.blue : C.sage,
              padding: '15px 16px',
            }}
          >
            <div className="min-w-0">
              <p
                className="font-bold"
                style={{ fontSize: '10px', letterSpacing: '0.2em', color: C.blueSoft }}
              >
                {t.todayActionTitle}
              </p>
              <p
                className="mt-1 truncate font-bold"
                style={{ fontSize: '15px', color: '#FFFFFF' }}
              >
                {stats.todoCount > 0
                  ? t.todayActionLine(stats.todoCount)
                  : t.todayActionDone}
              </p>
              {stats.todoCount > 0 && (
                <p
                  className="mt-0.5 tabular-nums"
                  style={{ fontSize: '11.5px', color: C.blueSoft }}
                >
                  ¥{yen(stats.todoTax)}
                </p>
              )}
            </div>
            {stats.todoCount > 0 && (
              <span
                className="shrink-0 font-bold"
                style={{ fontSize: '12.5px', color: '#FFFFFF' }}
              >
                {t.goCheck} ›
              </span>
            )}
          </button>
        )}

        {stats.deadlineSoon && (
          <div
            className="mt-3"
            style={{ backgroundColor: C.clay, padding: '15px 16px' }}
          >
            <p className="font-bold" style={{ fontSize: '13px', color: '#FFFFFF' }}>
              {t.deadlineBannerTitle(stats.deadlineSoon.count, stats.deadlineSoon.days)}
            </p>
            <p className="mt-1" style={{ fontSize: '11.5px', color: '#F3E7DD' }}>
              {t.deadlineBannerDetail(
                yen(stats.deadlineSoon.amount),
                stats.deadlineSoon.shop || t.pendingShopPlaceholder,
              )}
            </p>
          </div>
        )}
      </section>

      {dep ? (
        <section
          style={{
            borderTop: `1px solid ${C.ink}`,
            borderBottom: `1px solid ${C.ink}`,
          }}
        >
          <Row label={t.totalSpent} align="baseline">
            <span
              className="font-semibold tabular-nums"
              style={{ color: C.ink, fontSize: '24px' }}
            >
              ¥{yen(stats.totalIncl)}
            </span>
          </Row>

          <Row
            label={departed ? t.refundedTotalLabel : t.estRefund}
            sub={`≈ NT$${twd((departed ? stats.refundedTax : stats.refundable) * settings.rate)}`}
            align="end"
          >
            <span
              className="kaeru-refund font-semibold tabular-nums"
              style={{ color: C.blueDeep, lineHeight: 1 }}
            >
              ¥{yen(departed ? stats.refundedTax : stats.refundable)}
            </span>
          </Row>

          <Row label={t.pending}>
            {stats.pendingCount > 0 && (
              <Badge tone="blue" size="lg">
                {t.tripNow}
              </Badge>
            )}
            <span className="tabular-nums">
              <span
                className="font-semibold"
                style={{ color: C.ink, fontSize: '24px' }}
              >
                {stats.pendingCount}
              </span>
              <span className="ml-1 text-xs" style={{ color: C.sub }}>
                {t.itemsUnit}
              </span>
            </span>
          </Row>

          <Row label={t.nearestDeadline} last>
            {stats.minDays === null ? (
              <span className="text-sm" style={{ color: C.sub }}>
                {t.noDeadline}
              </span>
            ) : (
              <>
                <Badge tone={stats.minDays <= 14 ? 'clay' : 'outline'} size="lg">
                  {t.dueLeft} {stats.minDays} {t.days}
                </Badge>
                <span className="tabular-nums">
                  <span
                    className="font-semibold"
                    style={{ color: C.ink, fontSize: '24px' }}
                  >
                    {stats.minDays}
                  </span>
                  <span className="ml-1 text-xs" style={{ color: C.sub }}>
                    {t.days}
                  </span>
                </span>
              </>
            )}
          </Row>
        </section>
      ) : (
        // 沒有回程時間時只留三行——「還沒處理」「最近到期」這兩個概念
        // 都得靠回程時間才有意義，硬要顯示只會逼自己面對一堆「還沒有
        // 期限」，不如乾脆換成更誠實的摘要，剩下的疑問留給下面「還算
        // 不出來的事」統一講。已存的收據還是要看得到金額，不能因為
        // 回程時間沒填就連這個都藏起來。
        <section
          style={{
            borderTop: `1px solid ${C.ink}`,
            borderBottom: `1px solid ${C.ink}`,
          }}
        >
          <Row label={t.totalSpent} align="baseline">
            <span
              className="font-semibold tabular-nums"
              style={{ color: C.ink, fontSize: '24px' }}
            >
              ¥{yen(stats.totalIncl)}
            </span>
          </Row>
          <Row
            label={t.estRefund}
            sub={`≈ NT$${twd(stats.refundable * settings.rate)}`}
            align="end"
          >
            <span
              className="kaeru-refund font-semibold tabular-nums"
              style={{ color: C.blueDeep, lineHeight: 1 }}
            >
              ¥{yen(stats.refundable)}
            </span>
          </Row>
          <Row label={t.savedCountLabel(itemCount)} last>
            <button onClick={onGoList} className="font-bold" style={{ fontSize: '13px', color: C.blueDeep }}>
              {t.viewListCta} ›
            </button>
          </Row>
        </section>
      )}

      {!dep && (
        <section>
          <h3
            className="font-bold"
            style={{ color: C.blue, fontSize: '10.5px', letterSpacing: '0.24em' }}
          >
            {t.cantCalcYetLabel}
          </h3>
          <div className="mt-4" style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            {[
              [t.cantCalcDeadlinePerReceipt, t.deadlinePendingBadge],
              [t.cantCalcDepartDayFlow, t.notSetBadge],
              [t.cantCalcAirportQueue, t.notSetBadge],
            ].map(([label, badge], n) => (
              <div key={n} className="flex items-center justify-between gap-3">
                <span style={{ fontSize: '13.5px', color: C.ink }}>{label}</span>
                <Badge tone="outline">{badge}</Badge>
              </div>
            ))}
          </div>
          <p
            className="mt-4"
            style={{ backgroundColor: C.soft, padding: '14px', fontSize: '11.5px', color: C.sub, lineHeight: 1.8 }}
          >
            {t.cantCalcNote}
          </p>
        </section>
      )}

      {dep && !departed && (
        <section>
          <h3
            className="font-bold"
            style={{ color: C.blue, fontSize: '10.5px', letterSpacing: '0.24em' }}
          >
            {t.departChecklist}
          </h3>
          <ol
            className="mt-4"
            style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}
          >
            {[t.step1(arriveHoursText(t, arriveBuffer)), t.step2, t.step3, t.step4].map((x, n) => (
              <li key={n} className="flex" style={{ gap: '14px' }}>
                <span
                  className="shrink-0 font-bold tabular-nums"
                  style={{ color: C.blue, fontSize: '11px' }}
                >
                  {String(n + 1).padStart(2, '0')}
                </span>
                <span style={{ fontSize: '13px', lineHeight: 1.75 }}>{x}</span>
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}

// 倒數區的標籤／數字三態（倒數中／已出境／沒設回程時間），總覽正常
// 畫面跟畫面 39（已命名但沒收據）共用同一份——沒收據不代表倒數跟
// 查驗進度的邏輯不算，畫面 39 的截圖本來就有倒數，只是下面接的內容
// 不一樣。
function CountdownDisplay({ t, dep, diffMs, dDays, dHours, departed, onGoSettings }) {
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

// 空狀態．畫面 38：行程還沒命名（沒名字或沒回程時間），而且一張收據
// 都還沒加。用一張待填卡把「行程」這個概念亮出來，主 CTA 去把名字和
// 回程時間填上；逃生口讓使用者可以先加收據，晚點再回來補。
function EmptyUnnamedTrip({ t, trip, onEditTrip, onAdd, onStartSim }) {
  // 兩行狀態要照實際資料顯示，不能兩個都寫死「未填」——名字跟回程
  // 時間可能只缺一個（例如新增第二趟行程會帶入上次的回程時間，但
  // 名字是空的；反過來使用者也可能先取好名字才回頭填回程時間）。
  // 猜錯/騙人比留白更危險，見「擋住不如誠實」原則。
  const missingName = !trip || !trip.name;
  const missingDeparture = !trip || !trip.departure;
  const depDate = trip && trip.departure ? new Date(trip.departure) : null;
  const depLabel = depDate
    ? `${depDate.getMonth() + 1}/${depDate.getDate()} ${String(depDate.getHours()).padStart(2, '0')}:${String(depDate.getMinutes()).padStart(2, '0')}`
    : t.unfilled;
  // 名字本身不重要，回程時間才是地基——只缺回程時間時，標題／CTA
  // 改講回程時間，不要繼續講「還沒有名字」（那時名字已經填了）。
  const title = missingDeparture ? t.noDepartureTitle : t.emptyUnnamedTitle;
  const cta = missingDeparture ? t.setDepartureCta : t.emptyUnnamedCta;
  return (
    <div className="pb-6">
      <section className="pt-2">
        <div style={{ border: `1px dashed ${C.line}`, padding: '22px 20px' }}>
          <p style={{ fontSize: '10.5px', letterSpacing: '0.24em', color: C.sub }}>
            {t.emptyUnnamedKicker}
          </p>
          <p
            className="mt-2 font-bold"
            style={{ fontSize: '26px', color: C.sub, lineHeight: 1.2 }}
          >
            {title}
          </p>
          <div
            className="mt-3 flex flex-col"
            style={{
              gap: '8px',
              borderTop: `1px dashed ${C.line}`,
              paddingTop: '12px',
            }}
          >
            <div className="flex items-center justify-between">
              <span style={{ fontSize: '12.5px', color: C.sub }}>
                {t.tripName}
              </span>
              <span
                className="font-semibold"
                style={{ fontSize: '12.5px', color: missingName ? C.clayInk : C.ink }}
              >
                {missingName ? t.unfilled : trip.name}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span style={{ fontSize: '12.5px', color: C.sub }}>
                {t.departure}
              </span>
              <span
                className="font-semibold"
                style={{ fontSize: '12.5px', color: missingDeparture ? C.clayInk : C.ink }}
              >
                {depLabel}
              </span>
            </div>
          </div>
        </div>

        <p
          className="mt-5"
          style={{ fontSize: '13px', lineHeight: 1.95, color: C.ink }}
        >
          {t.emptyUnnamedDesc}
        </p>

        <button
          onClick={onEditTrip}
          className="mt-4 w-full py-3.5 font-bold"
          style={{ backgroundColor: C.blue, color: '#FFFFFF', fontSize: '14px' }}
        >
          {cta}
        </button>

        <p className="mt-3 text-center" style={{ fontSize: '12.5px' }}>
          <span style={{ color: C.sub }}>{t.emptyUnnamedOr}</span>{' '}
          <button
            onClick={onAdd}
            className="font-semibold"
            style={{ color: C.blueDeep }}
          >
            {t.emptyUnnamedEscape}
          </button>
        </p>
      </section>

      <section
        className="mt-6"
        style={{ borderTop: `1px solid ${C.ink}`, paddingTop: '16px' }}
      >
        <h3
          className="font-bold"
          style={{ color: C.blue, fontSize: '10.5px', letterSpacing: '0.24em' }}
        >
          {t.emptyUnnamedSimKicker}
        </h3>
        <button
          onClick={onStartSim}
          className="mt-3 block w-full text-left"
          style={{ backgroundColor: C.soft, padding: '22px', borderRadius: 0 }}
        >
          <p className="font-bold" style={{ fontSize: '18px', lineHeight: 1.4 }}>
            {t.sim}
          </p>
          <p className="mt-2" style={{ color: C.sub, fontSize: '12.5px', lineHeight: 1.8 }}>
            {t.emptyUnnamedSimDesc}
          </p>
          <span
            className="mt-4 inline-flex items-center gap-1 font-semibold"
            style={{ color: C.blueDeep, fontSize: '13px' }}
          >
            {t.startSim}
            <ChevronRight size={15} />
          </span>
        </button>
      </section>
    </div>
  );
}

// 空狀態．畫面 39：行程已經有名字、有回程時間，但還沒有任何一張
// 收據。金額用 sub 色顯示（¥0 只是佔位，不是真的有消費），收據區塊
// 改成填色 CTA，底下留一個「先看一遍規則」去 FAQ 的連結。
function EmptyNamedTrip({ t, trip, onAdd, onGoFaq, onGoSettings }) {
  useNowTick();
  const airport = trip && trip.airport ? AIRPORTS.find((a) => a.code === trip.airport) : null;
  // 已經有名字、有回程時間，只是還沒收據——倒數不會因為沒收據就算不
  // 出來，畫面 39 的截圖本來就顯示倒數，只是下面接的內容換成「行程
  // 已建立」徽章跟填色 CTA，不是查驗進度。
  const dep = trip && trip.departure ? new Date(trip.departure) : null;
  const diffMs = dep ? dep - new Date() : null;
  const dDays = diffMs !== null ? Math.floor(diffMs / 86400000) : null;
  const dHours =
    diffMs !== null ? Math.floor((diffMs % 86400000) / 3600000) : null;
  const departed = !!dep && diffMs <= 0;
  return (
    <div className="pb-6">
      <section className="pt-2">
        <CountdownDisplay
          t={t}
          dep={dep}
          diffMs={diffMs}
          dDays={dDays}
          dHours={dHours}
          departed={departed}
          onGoSettings={onGoSettings}
        />
        <div className="mt-4 flex flex-wrap gap-1.5">
          <Badge tone="sage" size="lg">
            {t.tripCreatedBadge}
          </Badge>
          {airport && (
            <span
              className="font-semibold"
              style={{
                fontSize: '10.5px',
                color: C.sub,
                border: `1px solid ${C.line}`,
                padding: '3px 7px',
              }}
            >
              {airport.name} {airport.code}
            </span>
          )}
        </div>
      </section>

      <section style={{ marginTop: '24px', borderTop: `1px solid ${C.ink}` }}>
        <div
          className="flex flex-col"
          style={{ gap: '15px', paddingTop: '18px' }}
        >
          <div className="flex items-baseline justify-between">
            <span style={{ fontSize: '12.5px', color: C.sub }}>
              {t.totalSpent}
            </span>
            <span
              className="font-semibold tabular-nums"
              style={{ fontSize: '24px', color: C.sub }}
            >
              ¥0
            </span>
          </div>
          <div
            className="flex items-end justify-between"
            style={{ borderTop: `1px solid ${C.line}`, paddingTop: '15px' }}
          >
            <span style={{ fontSize: '12.5px', color: C.sub }}>
              {t.estRefund}
            </span>
            <span
              className="font-semibold tabular-nums"
              style={{
                fontSize: '42px',
                color: C.sub,
                letterSpacing: '-0.01em',
                lineHeight: 1,
              }}
            >
              ¥0
            </span>
          </div>
        </div>
      </section>

      <section style={{ marginTop: '22px', padding: '20px', backgroundColor: C.soft }}>
        <p className="font-bold" style={{ fontSize: '15px', color: C.ink }}>
          {t.noReceiptsTitle}
        </p>
        <p className="mt-2" style={{ fontSize: '12.5px', lineHeight: 1.9, color: C.sub }}>
          {t.noReceiptsDesc}
        </p>
        <button
          onClick={onAdd}
          className="mt-4 w-full py-3 font-bold"
          style={{ backgroundColor: C.blue, color: '#FFFFFF', fontSize: '13px' }}
        >
          {t.addFirst}
        </button>
      </section>

      <button
        onClick={onGoFaq}
        className="flex w-full items-center justify-between"
        style={{ marginTop: '20px', borderTop: `1px solid ${C.line}`, paddingTop: '14px' }}
      >
        <span style={{ fontSize: '12.5px', color: C.ink }}>{t.rulesLinkLabel}</span>
        <span className="font-semibold" style={{ fontSize: '12.5px', color: C.blueDeep }}>
          {t.faqTitle} ›
        </span>
      </button>
    </div>
  );
}

// 畫面 40：偵測到「這趟結束了」跳出的底部面板。條件很嚴（回程超過
// 24 小時、且這趟的收據全部退款或失效），只跳一次；三個出口都不會
// 自動建立或切換行程，一律等使用者自己按。
function TripEndedSheet({
  t,
  trip,
  tripStats,
  refundedTax,
  daysSince,
  onClose,
  onCreateNew,
  onViewRecords,
}) {
  return (
    <BottomSheet onClose={onClose}>
      <div className="flex items-start justify-between gap-3">
        <h2
          className="font-bold"
          style={{ fontSize: '18px', lineHeight: 1.5, color: C.ink }}
        >
          {t.endedSheetTitle}
        </h2>
        <button onClick={onClose} style={{ color: C.sub }}>
          <X size={15} />
        </button>
      </div>

      <p className="mt-2" style={{ fontSize: '12.5px', lineHeight: 1.9, color: C.sub }}>
        {t.endedSheetDesc(trip.name || t.tripUnnamed, daysSince, tripStats.count)}
      </p>

      <div
        className="mt-3.5"
        style={{ borderTop: `1px solid ${C.line}`, paddingTop: '14px' }}
      >
        <div className="flex items-baseline justify-between">
          <span style={{ fontSize: '12.5px', color: C.sub }}>
            {t.endedSheetSettleLabel}
          </span>
          <span
            className="font-semibold tabular-nums"
            style={{ fontSize: '20px', color: C.blueDeep }}
          >
            ¥{yen(refundedTax)}
          </span>
        </div>
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {tripStats.refunded > 0 && (
            <Badge tone="sage">
              {tripStats.refunded}
              {t.statusRefunded}
            </Badge>
          )}
          {tripStats.dead > 0 && (
            <Badge tone="clay">
              {tripStats.dead}
              {t.statusDead}
            </Badge>
          )}
        </div>
      </div>

      <button
        onClick={onCreateNew}
        className="mt-5 w-full py-3.5 font-bold"
        style={{ backgroundColor: C.blue, color: '#FFFFFF', fontSize: '13.5px' }}
      >
        {t.endedSheetCta}
      </button>

      <div className="mt-4 flex items-center justify-center" style={{ gap: '22px' }}>
        <button onClick={onClose} style={{ fontSize: '12.5px', color: C.sub }}>
          {t.endedSheetNotNow}
        </button>
        <button
          onClick={onViewRecords}
          className="font-semibold"
          style={{ fontSize: '12.5px', color: C.blueDeep }}
        >
          {t.endedSheetViewRecords}
        </button>
      </div>

      <p
        className="mt-4"
        style={{
          borderTop: `1px solid ${C.line}`,
          paddingTop: '12px',
          fontSize: '11px',
          lineHeight: 1.75,
          color: C.sub,
        }}
      >
        {t.endedSheetFooterNote}
      </p>
    </BottomSheet>
  );
}

// ≤3 天期限警示：一次性站內提示（這個 app 沒有裝真的推播套件，用「打開
// App 時符合條件就跳一次」代替，跟「這趟結束了」同一種機制）。
function DeadlineWarnSheet({ t, deadlineSoon, onClose, onGoCheck }) {
  return (
    <BottomSheet onClose={onClose}>
      <div className="flex items-start justify-between gap-3">
        <h2
          className="font-bold"
          style={{ fontSize: '18px', lineHeight: 1.5, color: C.ink }}
        >
          {t.deadlineBannerTitle(deadlineSoon.count, deadlineSoon.days)}
        </h2>
        <button onClick={onClose} style={{ color: C.sub }}>
          <X size={15} />
        </button>
      </div>
      <p className="mt-2" style={{ fontSize: '12.5px', lineHeight: 1.9, color: C.clayInk }}>
        {t.deadlineBannerDetail(
          yen(deadlineSoon.amount),
          deadlineSoon.shop || t.pendingShopPlaceholder,
        )}
      </p>
      <button
        onClick={onGoCheck}
        className="mt-5 w-full py-3.5 font-bold"
        style={{ backgroundColor: C.blue, color: '#FFFFFF', fontSize: '13.5px' }}
      >
        {t.goCheck}
      </button>
    </BottomSheet>
  );
}

// 退款確認：回程後 7 天問一次「錢進來了嗎」。不要求使用者每天回來記——
// 逐張勾選「已經進帳」的，「都收到了」關掉這個提示以後不會再跳；
// 「還沒收到」把下一次提醒時間往後推 7 天，不會每天煩使用者，但也
// 不會像「這趟結束了」那樣永遠只問一次。
// 勾選框直接對應收據的「已退款」狀態（verified ↔ refunded），不是另外
// 弄一個跟收據本身脫鉤的核取清單——這裡打勾，就是在說「這張真的退到
// 錢了」，跟收據詳情頁按「已退款」是同一件事，沒有理由分兩份資料。
function RefundCheckSheet({
  t,
  trip,
  items,
  taxOf,
  onToggleStatus,
  onClose,
  onAllIn,
  onRemindLater,
  daysSince,
}) {
  const waiting = items
    .filter((it) => it.status !== 'refunded')
    .reduce((s, it) => s + taxOf(it), 0);
  return (
    <>
      <FullScreenSheet>
        <div
          className="sticky top-0 z-10 flex items-center justify-between kaeru-pad"
          style={{
            backgroundColor: C.page,
            borderBottom: `1px solid ${C.ink}`,
            paddingTop: 'max(16px, env(safe-area-inset-top))',
            paddingBottom: '16px',
          }}
        >
          <button onClick={onClose} style={{ fontSize: '13px', color: C.blueDeep }}>
            ‹ {t.back}
          </button>
          <h2 className="font-bold" style={{ fontSize: '15px' }}>
            {t.refundCheckTitle}
          </h2>
          <button
            onClick={onClose}
            className="font-bold"
            style={{ fontSize: '13px', color: C.blueDeep }}
          >
            {t.checkDone}
          </button>
        </div>

        <div className="kaeru-pad py-6">
          <p style={{ color: C.sub, fontSize: '11px', letterSpacing: '0.1em' }}>
            {t.refundCheckSubtitle(trip.name || t.tripUnnamed, daysSince)}
          </p>
          <p className="mt-2" style={{ fontSize: '14px', lineHeight: 1.95 }}>
            {t.refundCheckDesc(items.length)}
          </p>

          <div
            className="mt-4 flex items-baseline justify-between"
            style={{ borderTop: `1px solid ${C.ink}`, paddingTop: '14px' }}
          >
            <span style={{ fontSize: '12.5px', color: C.sub }}>
              {t.refundCheckWaiting}
            </span>
            <span
              className="font-semibold tabular-nums"
              style={{ fontSize: '26px', color: C.blueDeep }}
            >
              ¥{yen(waiting)}
            </span>
          </div>

          <div className="mt-2">
            {items.map((it, i) => {
              const checked = it.status === 'refunded';
              return (
                <button
                  key={it.id}
                  onClick={() => onToggleStatus(it.id, checked)}
                  className="flex w-full items-center justify-between gap-3 py-3.5 text-left"
                  style={{ borderTop: `1px solid ${i === 0 ? C.ink : C.line}` }}
                >
                  <span className="min-w-0">
                    <span className="block truncate font-bold" style={{ fontSize: '14.5px' }}>
                      {it.shop}
                    </span>
                    <span
                      className="mt-0.5 block tabular-nums"
                      style={{ color: C.sub, fontSize: '11px' }}
                    >
                      {it.date} · {t.taxAmount} ¥{yen(taxOf(it))}
                    </span>
                  </span>
                  <span
                    className="flex shrink-0 items-center justify-center"
                    style={{
                      width: '22px',
                      height: '22px',
                      backgroundColor: checked ? C.sage : 'transparent',
                      border: checked ? 'none' : `1px solid ${C.line}`,
                    }}
                  >
                    {checked && (
                      <CheckCircle2 size={14} style={{ color: '#FFFFFF' }} />
                    )}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="mt-4" style={{ backgroundColor: C.soft, padding: '14px' }}>
            <p style={{ color: C.sub, fontSize: '11.5px', lineHeight: 1.8 }}>
              {t.refundCheckInfo}
            </p>
          </div>

          <div className="mt-5 flex gap-2">
            <button
              onClick={onRemindLater}
              className="flex-1 py-3 text-sm"
              style={{ border: `1px solid ${C.line}`, color: C.sub }}
            >
              {t.refundCheckNotYet}
            </button>
            <button
              onClick={onAllIn}
              className="py-3 text-sm font-bold"
              style={{ flex: 1.4, backgroundColor: C.blue, color: '#FFFFFF' }}
            >
              {t.refundCheckAllIn}
            </button>
          </div>

          <button
            onClick={onRemindLater}
            className="mt-3 w-full text-center"
            style={{ fontSize: '11px', color: C.sub }}
          >
            {t.refundCheckRemindLater}
          </button>
        </div>
      </FullScreenSheet>
    </>
  );
}

function Row({ label, sub, last, align = 'center', children }) {
  return (
    <div
      className="flex justify-between gap-3 py-3"
      style={{
        borderBottom: last ? 'none' : `1px solid ${C.line}`,
        alignItems:
          align === 'end'
            ? 'flex-end'
            : align === 'baseline'
              ? 'baseline'
              : 'center',
      }}
    >
      <span>
        <span className="block" style={{ color: C.sub, fontSize: '12.5px' }}>
          {label}
        </span>
        {sub && (
          <span
            className="mt-0.5 block tabular-nums"
            style={{ color: C.sub, fontSize: '11px' }}
          >
            {sub}
          </span>
        )}
      </span>
      <span className="flex items-center" style={{ gap: '9px' }}>
        {children}
      </span>
    </div>
  );
}

function ListView({
  t,
  items,
  groups,
  taxOf,
  settings,
  itemPhotoCounts,
  hasDeparture,
  onEditTrip,
  onOpen,
  onAdd,
}) {
  const [filter, setFilter] = useState('all');

  if (!items.length) {
    return (
      <div
        className="rounded-2xl p-6 text-center"
        style={{ backgroundColor: C.card, border: `1px dashed ${C.line}` }}
      >
        <p className="text-sm" style={{ color: C.sub }}>
          {t.emptyList}
        </p>
        <button
          onClick={onAdd}
          className="mt-3 rounded-lg px-4 py-2 text-sm font-medium"
          style={{ backgroundColor: C.blue, color: '#FFFFFF' }}
        >
          {t.addReceipt}
        </button>
      </div>
    );
  }

  // 資料待補（快速新增、店名還沒補上）的收據不進一般的「同店同日」分組——
  // 店名是空的，硬分組只會把不相干的待補收據濫在一起。這裡拆出來，
  // 每一張獨立顯示，「待補」篩選只看得到它們，「全部」則排在最前面。
  const pendingItems = items
    .filter(isPendingInfo)
    .sort((a, b) => b.date.localeCompare(a.date));

  const match = (it) => {
    if (filter === 'all') return true;
    if (filter === 'done') return it.status === 'refunded';
    if (filter === 'todo') return it.status !== 'refunded' && !it.consumed;
    return true;
  };

  const showPendingSection =
    (filter === 'all' || filter === 'pending') && pendingItems.length > 0;
  const showGroupedSection = filter !== 'pending';

  const keys = showGroupedSection
    ? Array.from(groups.keys())
        .filter((k) => !groups.get(k).arr.every(isPendingInfo))
        .filter((k) =>
          groups.get(k).arr.some((it) => !isPendingInfo(it) && match(it)),
        )
        // 排序直接讀該組第一筆收據的 date，不要切 key 字串——key 是
        // `店名||日期` 手動拼出來的，店名要是剛好包含 "||" 這個子字串
        // （不無可能，店名是使用者自己輸入的自由文字），split 出來的
        // 段數會跑掉，日期就不會是預期的那一段。
        .sort((a, b) =>
          groups.get(b).arr[0].date.localeCompare(groups.get(a).arr[0].date),
        )
    : [];

  const nothingToShow =
    filter === 'pending' ? !pendingItems.length : !keys.length && !showPendingSection;

  // 沒有回程時間時，這些收據的卡片上都會掛「期限待定」——這裡數一次
  // 有幾張，跟每張卡片自己的 showDeadlinePending 判斷用同一套條件
  // （沒待補、沒消費掉、沒真的過期），才不會兩邊算出不同的數字。
  const deadlinePendingCount = hasDeparture
    ? 0
    : items.filter(
        (it) => !isPendingInfo(it) && !it.consumed && !isExpiredUnclaimed(it),
      ).length;

  return (
    <div className="space-y-4">
      <div
        className="flex"
        style={{ gap: '16px', borderBottom: `1px solid ${C.line}` }}
      >
        {['all', 'pending', 'todo', 'done'].map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className="shrink-0 pb-2.5"
            style={{
              fontSize: '12.5px',
              fontWeight: filter === f ? 700 : 500,
              color: filter === f ? C.ink : C.sub,
              borderBottom:
                filter === f ? `2px solid ${C.ink}` : '2px solid transparent',
              marginBottom: '-1px',
            }}
          >
            {t.filters[f]}
          </button>
        ))}
      </div>

      {deadlinePendingCount > 0 && (
        <button
          onClick={onEditTrip}
          className="flex w-full items-center justify-between gap-3 text-left"
          style={{ border: `1px dashed ${C.clay}`, padding: '14px 16px' }}
        >
          <div className="min-w-0">
            <p style={{ fontSize: '13.5px', fontWeight: 700, color: C.ink }}>
              {t.deadlinePendingBanner(deadlinePendingCount)}
            </p>
            <p className="mt-1" style={{ fontSize: '11.5px', color: C.sub }}>
              {t.deadlinePendingBannerDesc}
            </p>
          </div>
          <span className="shrink-0 font-bold" style={{ fontSize: '12.5px', color: C.blueDeep }}>
            {t.deadlinePendingSetCta} ›
          </span>
        </button>
      )}

      {showPendingSection && (
        <div style={{ backgroundColor: C.soft, padding: '14px 16px' }}>
          <p style={{ fontSize: '13px', fontWeight: 700, color: C.ink }}>
            {t.filterPendingBanner(pendingItems.length)}
          </p>
          <p
            className="mt-1"
            style={{ fontSize: '11.5px', color: C.sub, lineHeight: 1.7 }}
          >
            {t.filterPendingBannerDesc}
          </p>
        </div>
      )}

      {nothingToShow && (
        <p
          className="rounded-xl p-6 text-center text-sm"
          style={{
            backgroundColor: C.card,
            color: C.sub,
            border: `1px dashed ${C.line}`,
          }}
        >
          {t.noMatch}
        </p>
      )}

      {showPendingSection && (
        <div className="kaeru-group-gap">
          {pendingItems.map((it) => (
            <PendingReceiptCard
              key={it.id}
              it={it}
              t={t}
              taxOf={taxOf}
              onClick={() => onOpen(it.id)}
            />
          ))}
        </div>
      )}

      {showGroupedSection && (
        <div className="kaeru-group-gap">
          {keys.map((k) => {
            const g = groups.get(k);
            // 直接讀這組收據本身的 shop/date，不要切 key 字串——理由跟
            // 上面排序那段一樣，店名裡萬一有 "||" 會讓 split 錯位。
            const { shop, date } = g.arr[0];
            // 同一組所有收據共用同一個日期——過期不過期整組會一起翻，直接
            // 拿這個日期算一次就好。跟每張卡片自己的 expiredDead 判斷
            // 要一致：已在境內消費、已查驗、已退款都不算「錯過」，只有
            // 還卡在購買/登記階段、又超過 90 天的才算，不然表頭顯示
            // 「已過期」但裡面的卡片（例如已經退款的那張）卻正常顯示，
            // 兩邊會自相矛盾。
            const groupDays = daysLeft(date);
            const groupExpired =
              groupDays !== null &&
              groupDays < 0 &&
              g.arr.some(
                (it) =>
                  !it.consumed &&
                  it.status !== 'refunded' &&
                  it.status !== 'verified',
              );
            return (
              <section key={k}>
                <div
                  className="flex items-end justify-between gap-3 pb-2"
                  style={{
                    borderBottom: `1px solid ${g.ok && !groupExpired ? C.ink : C.clay}`,
                  }}
                >
                  <div className="min-w-0">
                    <h3
                      className="truncate font-bold"
                      style={{ fontSize: '13.5px' }}
                    >
                      {shop || '—'}
                    </h3>
                    <p
                      className="tabular-nums"
                      style={{ color: C.sub, fontSize: '11px' }}
                    >
                      {date} · {g.arr.length} {t.itemsUnit}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p
                      className="tabular-nums"
                      style={{ color: C.sub, fontSize: '11px' }}
                    >
                      {t.netTotal} ¥{yen(g.net)}
                    </p>
                    <span className="mt-1 inline-block">
                      {groupExpired ? (
                        <Badge tone="clay">{t.expiredBadge}</Badge>
                      ) : g.ok ? (
                        <Badge tone="sage">{t.reached}</Badge>
                      ) : (
                        <Badge tone="clay">
                          {t.short} ¥{yen(5000 - g.net)}
                        </Badge>
                      )}
                    </span>
                  </div>
                </div>
                <div style={{ border: `1px solid ${C.line}` }}>
                  {g.arr
                    .filter((it) => !isPendingInfo(it) && match(it))
                    .map((it, i) => (
                      <ReceiptCard
                        key={it.id}
                        it={it}
                        t={t}
                        taxOf={taxOf}
                        settings={settings}
                        groupOk={g.ok}
                        separator={i > 0}
                        itemPhotoCount={itemPhotoCounts[it.id] || 0}
                        hasDeparture={hasDeparture}
                        onEditTrip={onEditTrip}
                        onClick={() => onOpen(it.id)}
                      />
                    ))}
                </div>
              </section>
            );
          })}
        </div>
      )}

      {deadlinePendingCount > 0 && (
        <div style={{ borderTop: `1px solid ${C.ink}`, paddingTop: '20px' }}>
          <h3
            className="font-bold"
            style={{ color: C.blue, fontSize: '10.5px', letterSpacing: '0.24em' }}
          >
            {t.deadlinePendingWhatLabel}
          </h3>
          <ol className="mt-4" style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            {[
              t.deadlinePendingTip1,
              t.deadlinePendingTip2,
              t.deadlinePendingTip3,
            ].map((tip, n) => (
              <li key={n} className="flex" style={{ gap: '14px' }}>
                <span
                  className="shrink-0 font-bold tabular-nums"
                  style={{ color: C.blue, fontSize: '11px' }}
                >
                  {String(n + 1).padStart(2, '0')}
                </span>
                <span style={{ fontSize: '13px', lineHeight: 1.75 }}>{tip}</span>
              </li>
            ))}
          </ol>
          <p
            className="mt-4"
            style={{ backgroundColor: C.soft, padding: '14px', fontSize: '11.5px', color: C.sub, lineHeight: 1.8 }}
          >
            {t.deadlinePendingNote}
          </p>
        </div>
      )}
    </div>
  );
}

// 資料待補的收據卡——虛線框代表「資料還沒補齊」，跟空狀態的待填容器
// 同一個語意。待補現在有兩種各自獨立的原因：店名沒讀到、金額沒讀到
// （見 isPendingInfo），兩種可能同時發生，也可能只有其中一種——這張
// 卡要照實際缺什麼顯示，不能兩種都套同一句「店名待補」文案：店名讀到
// 了就要顯示真正的店名，金額讀到了就要顯示真正的金額，不能因為另一項
// 缺著，就連已經讀到的這項也用假資料蓋過去（那就是「¥0」那個 bug的
// 同一種錯法）。點進去都是開完整表單，補齊缺的部分。
function PendingReceiptCard({ it, t, taxOf, onClick }) {
  const tax = taxOf(it);
  const fmtShort = (iso) => {
    const dt = new Date(iso + 'T00:00:00');
    return `${dt.getMonth() + 1}/${dt.getDate()}`;
  };
  const shopKnown = !!(it.shop && it.shop.trim());
  const amountKnown = !!it.incl;
  const fillLink = !shopKnown && !amountKnown
    ? t.pendingFillAllLink
    : !shopKnown
      ? t.pendingFillLink
      : t.pendingFillAmountLink;
  return (
    <section>
      <div className="flex items-end justify-between gap-3 pb-2">
        <div className="min-w-0">
          <h3
            className="truncate font-bold"
            style={{ fontSize: '13.5px', color: shopKnown ? C.ink : C.sub }}
          >
            {shopKnown ? it.shop : t.pendingShopPlaceholder}
          </h3>
          <p style={{ color: C.sub, fontSize: '11px' }}>
            {t.pendingCapturedOn(fmtShort(it.date))}
          </p>
        </div>
        <Badge tone="outline">
          {!shopKnown ? t.pendingBadge : t.pendingAmountBadge}
        </Badge>
      </div>
      <button
        onClick={onClick}
        className="block w-full px-3.5 py-3.5 text-left"
        style={{ border: `1px dashed ${C.line}` }}
      >
        <div className="flex items-baseline justify-between gap-3">
          {amountKnown ? (
            <p
              className="font-semibold tabular-nums"
              style={{ fontSize: '18px', color: C.ink }}
            >
              ¥{yen(it.incl)}
            </p>
          ) : (
            <p className="font-semibold" style={{ fontSize: '15px', color: C.sub }}>
              {t.pendingAmountPlaceholder}
            </p>
          )}
          {amountKnown && (
            <p className="tabular-nums" style={{ color: C.sub, fontSize: '11px' }}>
              {t.taxAmount} ¥{yen(tax)}
            </p>
          )}
        </div>
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {amountKnown ? (
            netOfItem(it) >= 5000 ? (
              <Badge tone="sage">{t.reached}</Badge>
            ) : (
              <Badge tone="clay">
                {t.short} ¥{yen(5000 - netOfItem(it))}
              </Badge>
            )
          ) : (
            <Badge tone="outline">{t.pendingAmountBadge}</Badge>
          )}
          {it.refundMethod === 'registered' && (
            <Badge tone="outline">{t.refundReg}</Badge>
          )}
        </div>
        <p
          className="mt-2.5 font-semibold"
          style={{ color: C.blueDeep, fontSize: '12px' }}
        >
          {fillLink} ›
        </p>
      </button>
    </section>
  );
}

function ReceiptCard({
  it,
  t,
  taxOf,
  settings,
  groupOk,
  separator,
  itemPhotoCount,
  hasDeparture,
  onEditTrip,
  onClick,
}) {
  const d = daysLeft(it.date);
  const tax = taxOf(it);
  const consumedDead = !!it.consumed;
  // 已超過 90 天期限、還沒真的退到錢的收據，跟「已在境內消費」共用同一套
  // 失效樣式（卡底色、金額劃線）——但這是「來不及」不是「用掉了」，徽章
  // 跟說明文字要分開寫，進度軌跡也保留原本走到哪一步，不像消費那樣整個
  // 收縮成卡在第一步。
  // 跟 isExpiredUnclaimed() 同一個判斷：已查驗（verified）也要當成錢
  // 已經到手，不然一張查驗過但還沒手動標「已退款」的收據，一旦超過
  // 90 天就會被畫成失效樣式,跟首頁 stats.refundedTax 早就把它算進
  // 「已退回」的邏輯自相矛盾。
  const expiredDead =
    !consumedDead &&
    it.status !== 'refunded' &&
    it.status !== 'verified' &&
    d !== null &&
    d < 0;
  const dead = consumedDead || expiredDead;
  const warn = !dead && !groupOk;
  const stageIdx = STAGES.indexOf(it.status);
  const deadlineText =
    d === null ? null : d < 0 ? t.expired : `${t.warnDeadline} ${d} ${t.days}`;
  // d &lt; 0（已經過期）現在不再保證 dead 是 true——已查驗/已退款的收據
  // 就算超過 90 天也不算「來不及」（expiredDead 已經排除這兩種狀態），
  // 但那種情況下「期限剩 N 天」倒數徽章一樣沒意義，不能顯示負數天數，
  // 要另外擋掉，不能只靠 !dead。這裡還要加上 hasDeparture——沒有回程
  // 時間，「還剩 N 天」這個數字對使用者沒有實際意義（見
  // CLAUDE_CODE_DELTA_未設定回程時間.md），寧可老實顯示「期限待定」。
  const showDeadlineBadge = !dead && hasDeparture && d !== null && d >= 0 && d <= 30;
  // 沒有回程時間、這張也還沒失效（expiredDead 是拿沒有回程時間也算得
  // 出來的原始 d 判斷，跟這裡是不同層次的東西）——不管達不達標門檻，
  // 都要老實掛上「期限待定」，不能因為 warn 分支已經佔掉這個位置，
  // 就讓使用者以為這張沒有期限問題。
  const showDeadlinePending = !dead && !hasDeparture && d !== null;
  const showPendingBadge = !dead && !warn && stageIdx < 2;
  const tone = warn ? C.clay : expiredDead ? C.sub : C.blue;

  return (
    <Ticket
      tone={dead ? 'dead' : 'normal'}
      onClick={onClick}
      separator={separator}
    >
      <div className="flex items-baseline justify-between gap-3">
        <p
          className="font-semibold tabular-nums"
          style={{
            fontSize: '18px',
            color: dead ? C.sub : C.ink,
            textDecoration: dead ? 'line-through' : 'none',
            textDecorationColor: dead ? C.clay : 'currentColor',
          }}
        >
          ¥{yen(it.incl)}
        </p>
        <p className="tabular-nums" style={{ color: C.sub, fontSize: '11px' }}>
          {t.taxAmount} ¥{yen(tax)}
          {dead ? ` ${t.lostTax}` : ` ≈ NT$${twd(tax * settings.rate)}`}
        </p>
      </div>

      {/* 四段進度：7×7px 方點，中間連線撐滿。在境內消費時第一點填色、其餘
          變空心（整張收據作廢，走到哪一步不重要）；過期未退保留真正走到
          哪一步，只是用比較淡的顏色，表示這個進度已經沒有意義了。 */}
      <div className="mt-2.5 flex items-center">
        {STAGES.map((sname, n) => (
          <div key={sname} className="flex flex-1 items-center last:flex-none">
            <div
              className="shrink-0"
              style={
                consumedDead
                  ? n === 0
                    ? { width: '7px', height: '7px', backgroundColor: C.clay }
                    : {
                        width: '7px',
                        height: '7px',
                        border: `1px solid ${C.line}`,
                        backgroundColor: '#FFFFFF',
                      }
                  : {
                      width: '7px',
                      height: '7px',
                      backgroundColor: n <= stageIdx ? tone : C.line,
                    }
              }
            />
            {n < STAGES.length - 1 && (
              <div
                style={{
                  height: '1px',
                  flex: 1,
                  backgroundColor:
                    !consumedDead && n < stageIdx ? tone : C.line,
                }}
              />
            )}
          </div>
        ))}
      </div>

      {consumedDead ? (
        <p
          className="mt-1.5"
          style={{ color: C.clayInk, fontSize: '9.5px', fontWeight: 600 }}
        >
          {t.stalled}
        </p>
      ) : (
        <div className="mt-1.5 flex justify-between" style={{ fontSize: '9.5px' }}>
          {STAGES.map((sname, n) =>
            n === stageIdx ? (
              <span
                key={sname}
                className="font-semibold"
                style={{ color: expiredDead ? C.clayInk : warn ? C.clayInk : C.blueDeep }}
              >
                {expiredDead
                  ? t.stageShort[sname]
                  : warn
                    ? `${t.stuckAt}${t.stageShort[sname]}`
                    : t.stageShort[sname]}
              </span>
            ) : (
              <span key={sname} style={{ color: C.sub }}>
                {t.stageShort[sname]}
              </span>
            )
          )}
        </div>
      )}

      <div className="mt-2.5 flex flex-wrap gap-1.5">
        {consumedDead ? (
          <>
            <Badge tone="clay">{t.consumedShort}</Badge>
            <Badge tone="clay">{t.dead}</Badge>
            {it.unpacked && <Badge tone="outline">{t.unpackedShort}</Badge>}
          </>
        ) : expiredDead ? (
          <>
            <Badge tone="clay">{t.expiredBadge}</Badge>
            {it.unpacked && <Badge tone="outline">{t.unpackedShort}</Badge>}
            {it.refundMethod === 'registered' && (
              <Badge tone="outline">{t.refundReg}</Badge>
            )}
          </>
        ) : (
          <>
            {warn ? (
              <>
                <Badge tone="clay">{t.notReached}</Badge>
                <Badge tone="outline">{t.refillTip}</Badge>
              </>
            ) : (
              <>
                {showPendingBadge && <Badge tone="blue">{t.pendingCheck}</Badge>}
                {showDeadlineBadge && <Badge tone="clay">{deadlineText}</Badge>}
                {netOfItem(it) >= 1000000 && <Badge tone="blue">100万円+</Badge>}
              </>
            )}
            {showDeadlinePending && (
              // 線框＝待補，不是警示，故意不用 clay 填色——這張收據本身
              // 沒問題，只是還算不出期限。點了直接跳去填回程時間，不能
              // 冒泡到卡片本身的 onClick（那個是開詳情頁，兩個是不同的
              // 動作）。
              <span
                onClick={(e) => {
                  e.stopPropagation();
                  onEditTrip && onEditTrip();
                }}
                style={{ cursor: 'pointer' }}
              >
                <Badge tone="outline">{t.deadlinePendingBadge}</Badge>
              </span>
            )}
            {it.unpacked && <Badge tone="outline">{t.unpackedShort}</Badge>}
            {it.refundMethod === 'registered' && (
              <Badge tone="outline">{t.refundReg}</Badge>
            )}
          </>
        )}
      </div>

      {consumedDead && (
        <p
          className="mt-2.5"
          style={{ color: C.clayInk, fontSize: '11.5px', lineHeight: 1.8 }}
        >
          {t.deadCardNote}
        </p>
      )}
      {expiredDead && (
        <p
          className="mt-2.5"
          style={{ color: C.clayInk, fontSize: '11px' }}
        >
          {t.expired}
        </p>
      )}

      {/* 物品照片只是備忘，不是判讀資訊——不進卡片主體、不佔任何欄位
          位置，金額/達標/期限這些真正要看的東西一格都不讓。浮在右下角
          純粹是「這張收據還附了幾張物品照片」的提示，跟旁邊 tap 進
          詳情頁是同一個動作，不需要另外接一個獨立的點擊目標。 */}
      {itemPhotoCount > 0 && (
        <span
          className="absolute flex items-center gap-1"
          style={{ right: '14px', bottom: '14px', color: C.sub, fontSize: '11px' }}
        >
          <CameraIcon size={13} strokeWidth={1.6} />
          <span className="tabular-nums">{itemPhotoCount}</span>
        </span>
      )}
    </Ticket>
  );
}

function CheckView({ t, items, groups, taxOf, onVerifyAll, onVerifyOne }) {
  const eligible = items.filter((it) => {
    const g = groups.get(groupKey(it));
    // 資料待補（店名還沒補上）跟已超過 90 天沒退到的收據，不進查驗
    // 清單——待補的連店名都打不出來，沒辦法在機場核對；已過期的已經
    // 不用查驗了。
    return (
      g &&
      g.ok &&
      !it.consumed &&
      !isPendingInfo(it) &&
      !isExpiredUnclaimed(it)
    );
  });
  const todo = eligible
    .filter((it) => it.status === 'purchased' || it.status === 'registered')
    .sort((a, b) => a.date.localeCompare(b.date));
  const done = eligible.length - todo.length;
  const total = todo.reduce((s, i) => s + taxOf(i), 0);
  // 跟首頁 stats.refundedTax 同一個修正：已查驗（verified）也算進「已退」
  // 這個數字，不然這張收據的金額會兩邊金額欄位都看不到（不在 todo，
  // 因為已經查驗過；也不在原本只算 refunded 的這個總額）。
  const refunded = eligible
    .filter((it) => it.status === 'verified' || it.status === 'refunded')
    .reduce((s, i) => s + taxOf(i), 0);
  const pct = eligible.length ? Math.round((done / eligible.length) * 100) : 0;

  return (
    <div className="pb-6">
      <section className="pt-2">
        <p
          className="text-xs"
          style={{ color: C.sub, letterSpacing: '0.16em' }}
        >
          {t.checkIntro}
        </p>

        <div className="mt-3 flex items-baseline justify-between gap-3">
          <p
            className="flex items-baseline tabular-nums"
            style={{ letterSpacing: '-0.01em' }}
          >
            <span
              className="kaeru-bignum font-semibold"
              style={{ color: C.ink, lineHeight: 1 }}
            >
              {t.checkLeft} {todo.length}
            </span>
            <span
              style={{
                color: C.sub,
                fontSize: '16px',
                fontWeight: 500,
                marginLeft: '4px',
              }}
            >
              {t.itemsUnit}
            </span>
          </p>
          <span
            className="shrink-0 font-semibold tabular-nums"
            style={{ color: C.blueDeep, fontSize: '18px' }}
          >
            ¥{yen(total)}
          </span>
        </div>

        {eligible.length > 0 && (
          <div className="mt-3 flex" style={{ height: '1px' }}>
            <div
              style={{
                width: `${pct}%`,
                backgroundColor: C.sage,
                transition: 'width 400ms ease-out',
              }}
            />
            <div style={{ width: `${100 - pct}%`, backgroundColor: C.line }} />
          </div>
        )}

        <div
          className="mt-2.5 flex items-baseline justify-between"
          style={{ fontSize: '11.5px' }}
        >
          <span style={{ color: C.sub }}>
            {t.checkDoneRatio} {done} ／ {eligible.length} {t.itemsUnit}
          </span>
          <span style={{ color: C.sub }}>
            {t.checkRefunded} ¥{yen(refunded)}
          </span>
        </div>
      </section>

      {!todo.length && (
        <p
          className="mt-8 py-10 text-center text-sm"
          style={{ color: C.sub, borderTop: `1px solid ${C.line}` }}
        >
          {t.checkEmpty}
        </p>
      )}

      <div className="mt-6">
        {todo.map((it, n) => (
          <div
            key={it.id}
            className="py-2.5"
            style={{ borderTop: `1px solid ${n === 0 ? C.ink : C.line}` }}
          >
            <div className="flex items-baseline justify-between">
              <span
                className="font-bold tabular-nums"
                style={{ color: C.blue, fontSize: '12px' }}
              >
                {String(n + 1).padStart(2, '0')}
              </span>
              <span
                className="tabular-nums"
                style={{ color: C.sub, fontSize: '12px' }}
              >
                {it.date}
              </span>
            </div>

            <p className="mt-1.5 font-bold" style={{ fontSize: '20px' }}>
              {it.shop}
            </p>

            <div className="mt-3 flex items-baseline gap-8">
              <span>
                <span
                  className="block"
                  style={{ color: C.sub, fontSize: '11px' }}
                >
                  {t.inclAmount}
                </span>
                <span
                  className="mt-0.5 block font-semibold tabular-nums"
                  style={{ fontSize: '18px' }}
                >
                  ¥{yen(it.incl)}
                </span>
              </span>
              <span>
                <span
                  className="block"
                  style={{ color: C.sub, fontSize: '11px' }}
                >
                  {t.taxAmount}
                </span>
                <span
                  className="mt-0.5 block font-semibold tabular-nums"
                  style={{ color: C.blueDeep, fontSize: '18px' }}
                >
                  ¥{yen(taxOf(it))}
                </span>
              </span>
            </div>

            {it.note && (
              <p className="mt-2" style={{ color: C.sub, fontSize: '12px' }}>
                {it.note}
              </p>
            )}

            <button
              onClick={() => onVerifyOne(it.id)}
              className="mt-3 flex w-full items-center justify-center py-2.5 font-semibold"
              style={{
                border: `1px solid ${C.blue}`,
                color: C.blueDeep,
                fontSize: '12.5px',
                borderRadius: 0,
              }}
            >
              {t.markOne}
            </button>
          </div>
        ))}
      </div>

      {todo.length > 1 && (
        <button
          onClick={onVerifyAll}
          className="mt-6 w-full py-3.5 text-sm font-semibold"
          style={{
            backgroundColor: C.blue,
            color: '#FFFFFF',
            borderRadius: 0,
            borderTop: `1px solid ${C.ink}`,
          }}
        >
          {todo.length} {t.itemsUnit}
          {t.allDone}
        </button>
      )}

      <p
        className="mt-3 text-center"
        style={{ color: C.sub, fontSize: '11px' }}
      >
        {t.checkNote}
      </p>
    </div>
  );
}

function SectionLabel({ children }) {
  return (
    <div className="flex items-center gap-2.5">
      <h3
        className="font-bold"
        style={{ color: C.blue, fontSize: '10.5px', letterSpacing: '0.22em' }}
      >
        {children}
      </h3>
    </div>
  );
}

function FaqRow({ item, lang, open, onToggle }) {
  return (
    <div style={{ borderTop: `1px solid ${C.line}` }}>
      <button
        onClick={onToggle}
        className="flex w-full items-start justify-between gap-4 text-left"
        style={{ padding: '15px 0' }}
      >
        <span style={{ fontSize: '15px', lineHeight: 1.7 }}>
          {item.q[lang]}
        </span>
        <ChevronRight
          size={16}
          className="mt-1 shrink-0"
          style={{
            color: C.sub,
            transform: open ? 'rotate(90deg)' : 'none',
            transition: 'transform 150ms',
          }}
        />
      </button>
      {open && (
        <p
          style={{
            color: C.sub,
            fontSize: '13px',
            lineHeight: 2,
            margin: '0 24px 20px 0',
          }}
        >
          {item.a[lang]}
        </p>
      )}
    </div>
  );
}

function FaqView({ t, lang, onStart }) {
  // 每一區各自最多展開一題，互不影響——不是整頁只能開一題。預設值
  // 是每區第一題，加了「出境時」的 VJW 兩題之後，「消費稅是幾 %？」
  // 排到 buy 區第二題，不再是預設展開的那一題。
  const [open, setOpen] = useState({ buy: 'buy-0', exit: 'exit-0', refund: 'refund-0' });
  const sections = ['buy', 'exit', 'refund'];

  return (
    <div className="space-y-12 pb-6 pt-2">
      {sections.map((sec) => (
        <section key={sec}>
          <SectionLabel>{t.faqSection[sec]}</SectionLabel>
          <div className="mt-3">
            {QA.filter((x) => x.sec === sec).map((item, i) => {
              const key = `${sec}-${i}`;
              return (
                <FaqRow
                  key={key}
                  item={item}
                  lang={lang}
                  open={open[sec] === key}
                  onToggle={() =>
                    setOpen((prev) => ({
                      ...prev,
                      [sec]: prev[sec] === key ? null : key,
                    }))
                  }
                />
              );
            })}
          </div>
        </section>
      ))}

      <section>
        <SectionLabel>{t.tipsTitle}</SectionLabel>
        <ol
          className="mt-6"
          style={{ display: 'flex', flexDirection: 'column', gap: '22px' }}
        >
          {TIPS.map((tip, i) => (
            <li key={i} className="flex gap-5">
              <span
                className="shrink-0 font-bold tabular-nums"
                style={{ color: C.blue, opacity: 0.7, fontSize: '12px' }}
              >
                {String(i + 1).padStart(2, '0')}
              </span>
              <p style={{ fontSize: '13px', lineHeight: 2 }}>{tip[lang]}</p>
            </li>
          ))}
        </ol>
      </section>

      <button
        onClick={onStart}
        className="block w-full text-left"
        style={{ backgroundColor: C.soft, padding: '22px', borderRadius: 0 }}
      >
        <p className="font-bold" style={{ fontSize: '18px', lineHeight: 1.4 }}>
          {t.sim}
        </p>
        <p className="mt-2" style={{ color: C.sub, fontSize: '12.5px' }}>
          {t.simSub}
        </p>
        <span
          className="mt-5 inline-flex items-center gap-1 font-semibold"
          style={{ color: C.blueDeep, fontSize: '13px' }}
        >
          {t.startSim}
          <ChevronRight size={15} />
        </span>
      </button>

      <p className="text-center text-xs" style={{ color: C.sub }}>
        {t.source}
      </p>
    </div>
  );
}

function useCountUp(target, ms = 500) {
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

function Scenario({ t, lang, onExit }) {
  const [i, setI] = useState(-1);
  const [picked, setPicked] = useState(null);
  const [log, setLog] = useState([]);

  const total = log.reduce((s, x) => s + x.lose, 0);
  const lost = Math.min(total, SIM.max);
  const got = SIM.max - lost;
  const shown = useCountUp(got);

  const stepCount = i === -1 ? null : Math.min(i + 1, SIM.steps.length);
  const navBar = (
    <div
      className="flex items-center justify-between pb-3"
      style={{ borderBottom: `1px solid ${C.line}` }}
    >
      <button
        onClick={onExit}
        className="flex items-center gap-1"
        style={{ color: C.sub, fontSize: '13px' }}
      >
        <ChevronLeft size={15} /> {t.backToFaq}
      </button>
      {stepCount && (
        <span
          className="font-semibold tabular-nums"
          style={{ color: C.ink, fontSize: '13px' }}
        >
          {stepCount}
          {t.of}
          {SIM.steps.length}
        </span>
      )}
    </div>
  );

  const keyframes = `@keyframes jpFade{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}`;

  if (i === -1) {
    return (
      <div className="space-y-8 pb-6 pt-2">
        {navBar}
        <div>
          <h2
            className="font-bold"
            style={{ fontSize: '22px', lineHeight: 1.4 }}
          >
            {t.sim}
          </h2>
          <p
            className="mt-4"
            style={{ color: C.sub, fontSize: '14px', lineHeight: 2 }}
          >
            {SIM.intro[lang]}
          </p>
        </div>

        <div
          style={{ backgroundColor: C.soft, padding: '22px', borderRadius: 0 }}
        >
          <p style={{ color: C.sub, fontSize: '12.5px' }}>{t.simMax}</p>
          <p
            className="mt-1 font-bold tabular-nums"
            style={{ color: C.blueDeep, fontSize: '28px' }}
          >
            ¥{yen(SIM.max)}
          </p>
          <ul
            className="mt-4"
            style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}
          >
            {SIM.wallet[lang].map((w, n) => (
              <li
                key={n}
                className="flex items-baseline gap-2.5"
                style={{ fontSize: '13px' }}
              >
                <span
                  className="shrink-0"
                  style={{
                    width: '4px',
                    height: '4px',
                    backgroundColor: C.blue,
                  }}
                />
                <span style={{ lineHeight: 1.6 }}>{w}</span>
              </li>
            ))}
          </ul>
        </div>

        <button
          onClick={() => setI(0)}
          className="w-full py-3.5 text-sm font-semibold"
          style={{ backgroundColor: C.blue, color: '#FFFFFF', borderRadius: 0 }}
        >
          {t.startSim}
        </button>
      </div>
    );
  }

  if (i >= SIM.steps.length) {
    const misses = log.filter((x) => x.lose > 0 || x.penalty);
    const successCount = SIM.steps.length - misses.length;
    const pct = Math.round((got / SIM.max) * 100);
    // #14 修正：每一題卡片上顯示的「損失 ¥X」原本是各題各自的原始
    // 金額；題目之間如果對同一件虛擬商品有矛盾判定，逐題金額加總會
    // 超過上面「總共損失」（已經用 Math.min 封頂）的數字，畫面上兩個
    // 數字會自己矛盾。改成顯示「算進這一題之後，封頂總額往上增加了
    // 多少」，逐題累加起來保證跟封頂後的總額一致。
    let runningRaw = 0;
    const missesDisplay = misses.map((m) => {
      const before = Math.min(runningRaw, SIM.max);
      runningRaw += m.lose;
      const after = Math.min(runningRaw, SIM.max);
      return { ...m, displayLose: after - before };
    });
    return (
      <div className="space-y-10 pb-6 pt-2">
        <style>{keyframes}</style>
        {navBar}

        <div>
          <p
            className="font-bold"
            style={{
              color: C.sub,
              fontSize: '10.5px',
              letterSpacing: '0.24em',
            }}
          >
            {t.simDone}
          </p>
          <div className="mt-3 flex items-end justify-between gap-3">
            <div>
              <p style={{ color: C.sub, fontSize: '11px' }}>{t.simGot}</p>
              <p
                className="font-bold tabular-nums"
                style={{ color: C.blueDeep, fontSize: '48px', lineHeight: 1 }}
              >
                ¥{yen(shown)}
              </p>
            </div>
            <div className="text-right">
              <p style={{ color: C.sub, fontSize: '11px' }}>{t.simMax}</p>
              <p
                className="font-semibold tabular-nums"
                style={{ color: C.ink, fontSize: '17px' }}
              >
                ¥{yen(SIM.max)}
              </p>
            </div>
          </div>

          <div className="mt-4 flex" style={{ height: '1px' }}>
            <div
              style={{
                width: `${pct}%`,
                backgroundColor: C.sage,
                transition: 'width 600ms ease-out',
              }}
            />
            <div style={{ width: `${100 - pct}%`, backgroundColor: C.clay }} />
          </div>

          <div
            className="mt-2.5 flex items-baseline justify-between"
            style={{ fontSize: '11.5px' }}
          >
            <span style={{ color: C.sub }}>
              {t.simSuccess} {successCount} ／ {SIM.steps.length}{' '}
              {t.unitDecisions}
            </span>
            {lost > 0 && (
              <span className="font-semibold" style={{ color: C.clayInk }}>
                {t.simLost} ¥{yen(lost)}
              </span>
            )}
          </div>
        </div>

        {misses.length === 0 ? (
          <p
            style={{
              color: C.sub,
              fontSize: '14px',
              lineHeight: 1.8,
              borderTop: `1px solid ${C.ink}`,
              paddingTop: '16px',
            }}
          >
            {t.simPerfect}
          </p>
        ) : (
          <section style={{ borderTop: `1px solid ${C.ink}`, paddingTop: '16px' }}>
            <SectionLabel>{t.simWhy}</SectionLabel>
            <div className="mt-3">
              {missesDisplay.map((m, n) => (
                <div
                  key={n}
                  className="py-5"
                  style={{ borderTop: `1px solid ${C.line}` }}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span
                      className="font-bold tabular-nums"
                      style={{ color: C.blue, fontSize: '12px' }}
                    >
                      {t.simStep} {String(m.step + 1).padStart(2, '0')}
                    </span>
                    {m.displayLose > 0 && (
                      <Badge tone="clay">
                        {t.simLost} ¥{yen(m.displayLose)}
                      </Badge>
                    )}
                  </div>
                  <p className="mt-2 font-bold" style={{ fontSize: '15px' }}>
                    {m.label[lang]}
                  </p>
                  <p
                    className="mt-1.5"
                    style={{ fontSize: '12.5px', lineHeight: 1.95 }}
                  >
                    {(m.penalty || m.fb)[lang]}
                  </p>
                </div>
              ))}
            </div>
          </section>
        )}

        <section style={{ borderTop: `1px solid ${C.line}`, paddingTop: '16px' }}>
          <SectionLabel>{t.rulesTitle}</SectionLabel>
          <ol className="mt-4 space-y-5">
            {RULES[lang].slice(0, 3).map((r, n) => (
              <li key={n} className="flex gap-4">
                <span
                  className="shrink-0 font-bold tabular-nums"
                  style={{ color: C.blue, fontSize: '12px' }}
                >
                  {String(n + 1).padStart(2, '0')}
                </span>
                <p style={{ fontSize: '14px', lineHeight: 1.75 }}>{r}</p>
              </li>
            ))}
          </ol>
        </section>

        <div className="flex gap-3">
          <button
            onClick={() => {
              setI(-1);
              setPicked(null);
              setLog([]);
            }}
            className="flex-1 py-3.5 text-sm font-semibold"
            style={{
              border: `1px solid ${C.blue}`,
              color: C.blueDeep,
              borderRadius: 0,
            }}
          >
            {t.again}
          </button>
          <button
            onClick={onExit}
            className="flex-1 py-3.5 text-sm font-semibold"
            style={{
              backgroundColor: C.blue,
              color: '#FFFFFF',
              borderRadius: 0,
            }}
          >
            {t.backToFaq}
          </button>
        </div>
      </div>
    );
  }

  const step = SIM.steps[i];
  const canContinue = picked !== null;

  return (
    <div className="pb-6 pt-2">
      <style>{keyframes}</style>
      {navBar}

      {/* 九段進度 */}
      <div className="mt-5 flex" style={{ gap: '3px' }}>
        {SIM.steps.map((_, n) => (
          <div
            key={n}
            style={{
              height: '3px',
              flex: 1,
              backgroundColor: n <= i ? C.blue : C.line,
            }}
          />
        ))}
      </div>

      <div className="mt-6 flex items-baseline justify-between gap-3">
        <span
          className="font-bold"
          style={{ color: C.blue, fontSize: '10.5px', letterSpacing: '0.2em' }}
        >
          {step.where[lang]}
        </span>
        <span
          className="font-semibold tabular-nums"
          style={{ color: C.blueDeep, fontSize: '17px' }}
        >
          {t.simGot} ¥{yen(shown)}
        </span>
      </div>

      <p className="mt-4" style={{ fontSize: '14px', lineHeight: 2 }}>
        {step.scene[lang]}
      </p>
      <p className="mt-2 font-bold" style={{ fontSize: '19px' }}>
        {step.q[lang]}
      </p>

      {/* 選項 */}
      <div
        className="mt-5"
        style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}
      >
        {step.opts.map((o, n) => {
          const isChosen = picked === n;
          if (!isChosen) {
            return (
              <button
                key={n}
                disabled={picked !== null}
                onClick={() => {
                  setPicked(n);
                  setLog((l) => [
                    ...l,
                    {
                      step: i,
                      lose: o.lose || 0,
                      fb: o.fb,
                      penalty: o.penalty,
                      label: o.label,
                    },
                  ]);
                }}
                className="w-full text-left"
                style={{
                  border: `1px solid ${C.line}`,
                  color: C.sub,
                  fontSize: '14px',
                  lineHeight: 1.6,
                  padding: '14px 16px',
                  opacity: picked !== null ? 0.5 : 1,
                }}
              >
                {o.label[lang]}
              </button>
            );
          }
          const good = !!o.best;
          return (
            <div
              key={n}
              style={{
                border: `1px solid ${good ? C.sage : C.clay}`,
                backgroundColor: C.soft,
                padding: '14px 16px',
                animation: 'jpFade 220ms ease-out',
              }}
            >
              <div className="flex items-start justify-between gap-3">
                <span
                  className="font-bold"
                  style={{ fontSize: '14px', lineHeight: 1.6 }}
                >
                  {o.label[lang]}
                </span>
                <Badge tone={good ? 'sage' : 'clay'}>
                  {good ? t.simGood : t.simBad}
                </Badge>
              </div>
              <p
                className="mt-2.5"
                style={{ fontSize: '12.5px', lineHeight: 1.95 }}
              >
                {o.fb[lang]}
              </p>
              {o.lose > 0 && (
                <span className="mt-2 inline-block">
                  <Badge tone="clay">
                    {t.simLost} ¥{yen(o.lose)}
                  </Badge>
                </span>
              )}
            </div>
          );
        })}
      </div>

      <div
        className="mt-6 flex items-center justify-between gap-3 pt-4"
        style={{ borderTop: `1px solid ${C.line}` }}
      >
        <span style={{ color: C.sub, fontSize: '11px' }}>
          {t.simMax} ¥{yen(SIM.max)}
        </span>
        <button
          onClick={() => {
            setI(i + 1);
            setPicked(null);
          }}
          disabled={!canContinue}
          className="flex items-center gap-1 font-semibold disabled:opacity-40"
          style={{
            backgroundColor: C.blue,
            color: '#FFFFFF',
            fontSize: '13px',
            padding: '10px 20px',
            borderRadius: 0,
          }}
        >
          {t.next} <ChevronRight size={14} />
        </button>
      </div>
    </div>
  );
}

function SettingsView({
  t,
  settings,
  setSettings,
  trip,
  count,
  onEditTrip,
  onFetchRate,
  rateBusy,
  rateErr,
  onOpenDataManage,
  onOpenAbout,
}) {
  const rowStyle = (first) => ({
    display: 'block',
    width: '100%',
    textAlign: 'left',
    padding: '18px 0',
    borderBottom: `1px solid ${C.line}`,
    borderTop: first ? `1px solid ${C.ink}` : 'none',
  });
  const labelStyle = {
    color: C.blue,
    fontSize: '10.5px',
    letterSpacing: '0.24em',
    fontWeight: 700,
  };

  return (
    <div className="pb-6 pt-2">
      <button onClick={onEditTrip} style={rowStyle(true)}>
        <span className="block" style={labelStyle}>
          {t.trips}
        </span>
        <span className="mt-2 flex items-center justify-between gap-2">
          <span style={{ fontSize: '17px' }}>
            {trip && trip.name ? trip.name : t.tripNow}
          </span>
          <span className="flex shrink-0 items-center gap-1.5">
            <Badge tone="blue">{t.tripNow}</Badge>
            <span
              className="flex items-center tabular-nums"
              style={{ color: C.sub, fontSize: '11.5px' }}
            >
              {count} {t.itemsUnit} <ChevronRight size={13} />
            </span>
          </span>
        </span>
      </button>

      <div style={rowStyle(false)}>
        <div className="flex items-baseline justify-between gap-2">
          <span style={labelStyle}>
            {t.rate} {t.twd}
          </span>
          <button
            onClick={onFetchRate}
            disabled={rateBusy}
            className="shrink-0 text-xs disabled:opacity-50"
            style={{ color: C.blueDeep, textDecoration: 'underline' }}
          >
            {rateBusy ? t.fetching : t.fetchRate}
          </button>
        </div>
        <input
          type="number"
          step="0.0001"
          min="0"
          value={settings.rate}
          onChange={(e) =>
            setSettings((s) => ({
              ...s,
              // #13 修正：原本沒有防呆，可以打負數匯率，會讓所有 NT$
              // 換算的地方顯示負的台幣金額。夾在 0 以上。
              rate: Math.max(0, Number(e.target.value) || 0),
              rateAt: null,
            }))
          }
          className="mt-2 block w-full bg-transparent font-semibold tabular-nums outline-none"
          style={{ border: 'none', fontSize: '17px', color: C.ink }}
        />
        <p className="mt-1 text-xs" style={{ color: C.sub }}>
          {settings.rateAt
            ? `${t.rateAt} ${(() => {
                const d = new Date(settings.rateAt);
                return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
              })()}`
            : t.manual}
        </p>
        {rateErr && (
          <p className="mt-1.5 text-xs" style={{ color: C.clayInk }}>
            {t.rateFail}
          </p>
        )}
      </div>

      <div style={rowStyle(false)}>
        <span className="block" style={labelStyle}>
          {t.language}
        </span>
        <div className="mt-2.5 flex gap-6">
          {[
            ['zh', '繁體中文'],
            ['ja', '日本語'],
          ].map(([k, label]) => (
            <button
              key={k}
              onClick={() => setSettings((s) => ({ ...s, lang: k }))}
              className="pb-1.5"
              style={{
                fontSize: '15px',
                fontWeight: settings.lang === k ? 700 : 400,
                color: settings.lang === k ? C.ink : C.sub,
                borderBottom:
                  settings.lang === k
                    ? `2px solid ${C.ink}`
                    : '2px solid transparent',
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <button onClick={onOpenDataManage} style={rowStyle(false)}>
        <span className="block" style={labelStyle}>
          {t.dataManageKicker}
        </span>
        <span className="mt-2 flex items-center justify-between gap-2">
          <span style={{ fontSize: '17px' }}>{t.dataManageTitle}</span>
          <ChevronRight size={15} style={{ color: C.sub, flexShrink: 0 }} />
        </span>
        <p className="mt-1.5" style={{ color: C.sub, fontSize: '12px', lineHeight: 1.7 }}>
          {t.dataManageRowDesc}
        </p>
      </button>

      <button
        onClick={onOpenAbout}
        className="flex w-full items-center justify-between gap-2"
        style={rowStyle(false)}
      >
        <span style={{ fontSize: '15px', color: C.ink }}>{t.aboutRowLabel}</span>
        <ChevronRight size={15} style={{ color: C.sub, flexShrink: 0 }} />
      </button>

      <p
        className="mt-10 pb-2 text-center"
        style={{ color: C.sub, fontSize: '10.5px' }}
      >
        {t.source}
      </p>
    </div>
  );
}

/* ---------------- sheets ---------------- */

/* 新增收據／收據詳情：整頁覆蓋，自己的標題列 */
function FullScreenSheet({ children }) {
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

/* 行程切換：貼底 bottom sheet，不做圓角 */
function BottomSheet({ onClose, children }) {
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

// 置中對話框——整個 App 目前只有刪除確認（畫面 60）用這個版面，跟
// BottomSheet（貼底）刻意做成不同形狀：這是唯一一個要使用者在動手
// 之前先「停下來讀完」的畫面，貼底 sheet 那種「隨手往下滑就關掉」
// 的手感不適合放在這裡。
function CenterDialog({ onClose, children }) {
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

// 畫面 58：資料管理——匯出跟刪除的入口，兩件事故意放同一頁、份量
//相等（見 CLAUDE_CODE_DELTA_匯出與刪除.md）：純本機儲存讓匯出成為
// 唯一的備份手段，匯出不是附屬功能。
function DataManageSheet({
  t,
  items,
  trips,
  photos,
  activeTripId,
  onClose,
  onOpenExport,
  onOpenDeleteEnded,
  onOpenDeletePhotosOnly,
  onOpenDeleteAll,
}) {
  const photoStats = useMemo(
    () => photoStatsFrom(collectAllPhotos(items, photos)),
    [items, photos],
  );
  const endedTrips = useMemo(() => trips.filter(isTripEnded), [trips]);
  const endedTripIds = useMemo(
    () => new Set(endedTrips.map((x) => x.id)),
    [endedTrips],
  );
  const endedItemsCount = useMemo(
    () => items.filter((i) => endedTripIds.has(i.tripId)).length,
    [items, endedTripIds],
  );

  function Row({ label, onClick, disabled, ctaLabel, ctaColor }) {
    return (
      <button
        onClick={onClick}
        disabled={disabled}
        className="flex w-full items-center justify-between gap-3 text-left disabled:opacity-40"
        style={{ padding: '15px 0', borderBottom: `1px solid ${C.line}` }}
      >
        <span style={{ fontSize: '14.5px', color: C.ink }}>{label}</span>
        <span
          className="flex shrink-0 items-center gap-0.5 font-bold"
          style={{ fontSize: '13px', color: ctaColor }}
        >
          {ctaLabel}
          <ChevronRight size={14} />
        </span>
      </button>
    );
  }

  return (
    <FullScreenSheet>
      <div
        className="sticky top-0 z-10 flex items-center justify-between kaeru-pad"
        style={{
          backgroundColor: C.page,
          borderBottom: `1px solid ${C.ink}`,
          paddingTop: 'max(16px, env(safe-area-inset-top))',
          paddingBottom: '16px',
        }}
      >
        <button onClick={onClose} style={{ fontSize: '13px', color: C.sub }}>
          {t.cancel}
        </button>
        <h2 className="font-bold" style={{ fontSize: '15px' }}>
          {t.dataManageTitle}
        </h2>
        <span
          aria-hidden="true"
          style={{ fontSize: '13px', color: 'transparent', userSelect: 'none' }}
        >
          {t.cancel}
        </span>
      </div>

      <div className="kaeru-pad py-6">
        <p style={{ fontSize: '13px', color: C.sub, lineHeight: 1.85 }}>
          {t.dataManageDesc}
        </p>

        <div
          className="mt-5 flex items-baseline justify-between gap-3"
          style={{ borderTop: `1px solid ${C.ink}`, paddingTop: '16px' }}
        >
          <p
            className="font-semibold tabular-nums"
            style={{ fontSize: '28px', color: C.ink }}
          >
            {t.dataManageReceiptCount(items.length)}
          </p>
          <p className="tabular-nums" style={{ fontSize: '12.5px', color: C.sub }}>
            {t.dataManagePhotoUsage(photoStats.count, formatBytes(photoStats.bytes))}
          </p>
        </div>

        <div className="mt-6">
          <SectionLabel>{t.exportSectionLabel}</SectionLabel>
          <div className="mt-1">
            {!!activeTripId && (
              <Row
                label={t.exportThisTrip}
                onClick={() => onOpenExport({ kind: 'trip', tripId: activeTripId })}
                ctaLabel={t.exportCta}
                ctaColor={C.blueDeep}
              />
            )}
            <Row
              label={t.exportAllTrips}
              onClick={() => onOpenExport({ kind: 'all' })}
              ctaLabel={t.exportCta}
              ctaColor={C.blueDeep}
            />
          </div>
        </div>

        <div className="mt-6">
          <SectionLabel>{t.deleteSectionLabel}</SectionLabel>
          <div className="mt-1">
            <Row
              label={t.deleteEndedTripsRow(endedItemsCount)}
              onClick={onOpenDeleteEnded}
              disabled={endedTrips.length === 0}
              ctaLabel={t.deleteCta}
              ctaColor={C.clayInk}
            />
            <Row
              label={t.deletePhotosOnlyRow(formatBytes(photoStats.bytes))}
              onClick={onOpenDeletePhotosOnly}
              disabled={photoStats.count === 0}
              ctaLabel={t.deleteCta}
              ctaColor={C.clayInk}
            />
            <Row
              label={t.deleteAllDataRow}
              onClick={onOpenDeleteAll}
              disabled={items.length === 0 && trips.length === 0}
              ctaLabel={t.deleteCta}
              ctaColor={C.clayInk}
            />
          </div>
        </div>

        <p className="mt-6" style={{ fontSize: '11.5px', color: C.sub, lineHeight: 1.8 }}>
          {t.dataManageOutro}
        </p>
      </div>
    </FullScreenSheet>
  );
}

// 畫面 59：匯出選項。CTA 文字跟著選中的格式變，數字都是這次真的會
// 匯出的內容算出來的，不是隨便寫的估計值。
function ExportOptionsSheet({
  t,
  lang,
  scope,
  items,
  trips,
  photos,
  onClose,
  onExported,
}) {
  const [format, setFormat] = useState('csv');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(false);

  const scopeItems = useMemo(() => {
    if (scope.kind === 'trip') return items.filter((it) => it.tripId === scope.tripId);
    return items;
  }, [items, scope]);

  const tripNameFor = (tripId) => {
    const trip = trips.find((x) => x.id === tripId);
    return trip && trip.name ? trip.name : t.csvUnnamedTrip;
  };
  const stageLabelFor = (status) => t.stageShort[status] || '';
  const refundLabelFor = (method) =>
    method === 'registered'
      ? t.refundOptRegistered
      : method === 'no'
        ? t.refundOptNo
        : t.refundOptUnsure;

  const csv = useMemo(
    () =>
      buildCsv(scopeItems, {
        headers: t.csvHeaders,
        tripNameFor,
        stageLabelFor,
        refundLabelFor,
        mixedRateLabel: t.csvMixedRateLabel,
      }),
    [scopeItems, lang],
  );
  const scopePhotos = useMemo(
    () => collectAllPhotos(scopeItems, photos),
    [scopeItems, photos],
  );
  const zipEstimateBytes = useMemo(
    () => estimateZipBytes(csv.bytes, scopePhotos),
    [csv.bytes, scopePhotos],
  );

  const scopeTitle =
    scope.kind === 'trip' ? t.exportForTrip(tripNameFor(scope.tripId)) : t.exportForAll;

  async function handleExport() {
    if (busy) return;
    setBusy(true);
    setErr(false);
    try {
      const stamp = todayStr().replace(/-/g, '');
      if (format === 'csv') {
        await shareExportedFile(`kaeru-${stamp}.csv`, 'text/csv', csv.text);
      } else {
        const zip = buildZip(csv.text, scopePhotos);
        await shareExportedFile(`kaeru-${stamp}.zip`, 'application/zip', zip);
      }
      onExported();
    } catch (e) {
      setErr(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <FullScreenSheet>
      <div
        className="sticky top-0 z-10 flex items-center justify-between kaeru-pad"
        style={{
          backgroundColor: C.page,
          borderBottom: `1px solid ${C.ink}`,
          paddingTop: 'max(16px, env(safe-area-inset-top))',
          paddingBottom: '16px',
        }}
      >
        <button onClick={onClose} style={{ fontSize: '13px', color: C.sub }}>
          {t.cancel}
        </button>
        <h2 className="font-bold" style={{ fontSize: '15px' }}>
          {scopeTitle}
        </h2>
        <span
          aria-hidden="true"
          style={{ fontSize: '13px', color: 'transparent', userSelect: 'none' }}
        >
          {t.cancel}
        </span>
      </div>

      <div className="kaeru-pad py-6" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <div className="flex gap-2">
          {[
            ['csv', t.exportFormatCsvLabel, formatBytes(csv.bytes)],
            ['zip', t.exportFormatZipLabel, formatBytes(zipEstimateBytes)],
          ].map(([v, label, size]) => (
            <button
              key={v}
              onClick={() => setFormat(v)}
              className="flex-1 text-left"
              style={{
                padding: '13px 14px',
                border: `1px solid ${format === v ? C.ink : C.line}`,
                backgroundColor: format === v ? C.soft : C.page,
              }}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold" style={{ fontSize: '13.5px', color: C.ink }}>
                  {label}
                </span>
                {/* 圓形 radio——整個 App 唯一用圓角的地方，其他一律四方角 */}
                <span
                  className="flex shrink-0 items-center justify-center"
                  style={{
                    width: '17px',
                    height: '17px',
                    borderRadius: '50%',
                    border: `1px solid ${format === v ? C.ink : C.line}`,
                  }}
                >
                  {format === v && (
                    <span
                      style={{
                        width: '8px',
                        height: '8px',
                        borderRadius: '50%',
                        backgroundColor: C.blue,
                      }}
                    />
                  )}
                </span>
              </div>
              <p className="mt-1 tabular-nums" style={{ fontSize: '11px', color: C.sub }}>
                {size}
              </p>
            </button>
          ))}
        </div>

        <ol style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {[t.exportTip1, t.exportTip2, t.exportTip3].map((tip, i) => (
            <li key={i} className="flex gap-3">
              <span
                className="shrink-0 font-bold tabular-nums"
                style={{ color: C.blue, opacity: 0.7, fontSize: '11px' }}
              >
                {String(i + 1).padStart(2, '0')}
              </span>
              <p style={{ fontSize: '12.5px', lineHeight: 1.8, color: C.ink }}>{tip}</p>
            </li>
          ))}
        </ol>

        <div style={{ backgroundColor: C.soft, padding: '14px' }}>
          <p className="font-bold" style={{ fontSize: '13px', color: C.ink }}>
            {t.exportBoundaryTitle}
          </p>
          <p className="mt-1.5" style={{ color: C.sub, fontSize: '11.5px', lineHeight: 1.8 }}>
            {t.exportBoundaryDesc}
          </p>
        </div>

        {err && (
          <p style={{ fontSize: '12px', color: C.clayInk }}>{t.exportFailed}</p>
        )}

        <div>
          <button
            onClick={handleExport}
            disabled={busy}
            className="w-full py-3.5 text-sm font-semibold disabled:opacity-60"
            style={{ backgroundColor: C.blue, color: '#FFFFFF' }}
          >
            {busy ? t.exporting : format === 'csv' ? t.exportCtaCsv : t.exportCtaZip}
          </button>
          <p className="mt-2 text-center" style={{ fontSize: '11px', color: C.sub }}>
            {t.exportShareHint}
          </p>
        </div>
      </div>
    </FullScreenSheet>
  );
}

// 畫面 60：刪除確認。置中對話框，不做二次輸入確認——清單已經把後果
// 列完，再加一層是懲罰不是保護。「先匯出」故意比「刪除」顯眼：那是
// 唯一能救回資料的動作，使用者按到這一步通常沒想過要備份。
function DeleteConfirmSheet({
  t,
  scope,
  items,
  trips,
  photos,
  lastExportedAt,
  onClose,
  onExportFirst,
  onConfirmDelete,
}) {
  const scopeTrips = useMemo(
    () => (scope.kind === 'endedTrips' ? trips.filter(isTripEnded) : trips),
    [scope, trips],
  );
  const scopeTripIds = useMemo(() => new Set(scopeTrips.map((x) => x.id)), [scopeTrips]);
  const scopeItems = useMemo(
    () =>
      scope.kind === 'endedTrips'
        ? items.filter((i) => scopeTripIds.has(i.tripId))
        : items,
    [items, scope, scopeTripIds],
  );
  const photoStats = useMemo(
    () => photoStatsFrom(collectAllPhotos(scopeItems, photos)),
    [scopeItems, photos],
  );

  const title = scope.kind === 'endedTrips' ? t.deleteConfirmEndedTitle : t.deleteConfirmAllTitle;
  const fmtDate = (iso) => {
    const d = new Date(iso);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  return (
    <CenterDialog onClose={onClose}>
      <p className="font-bold" style={{ fontSize: '17px', color: C.ink, lineHeight: 1.4 }}>
        {title}
      </p>
      <p className="mt-2" style={{ fontSize: '13px', color: C.sub, lineHeight: 1.75 }}>
        {t.deleteConfirmDesc(scopeItems.length, photoStats.count, scopeTrips.length)}
      </p>

      <div
        className="mt-4 flex flex-col"
        style={{ gap: '10px', borderTop: `1px dashed ${C.line}`, paddingTop: '14px' }}
      >
        <div className="flex items-center justify-between gap-2">
          <span style={{ fontSize: '13px', color: C.sub }}>{t.deleteConfirmReceiptsRow(scopeItems.length)}</span>
        </div>
        <div className="flex items-center justify-between gap-2">
          <span style={{ fontSize: '13px', color: C.sub }}>
            {t.deleteConfirmPhotosRow(photoStats.count, formatBytes(photoStats.bytes))}
          </span>
        </div>
        <div className="flex items-center justify-between gap-2">
          <span style={{ fontSize: '13px', color: C.sub }}>{t.deleteConfirmTripsRow(scopeTrips.length)}</span>
        </div>
      </div>

      <div className="mt-4" style={{ backgroundColor: C.soft, padding: '13px' }}>
        <p className="font-semibold" style={{ fontSize: '12.5px', color: C.ink }}>
          {lastExportedAt ? t.deleteConfirmLastExported(fmtDate(lastExportedAt)) : t.deleteConfirmNeverExported}
        </p>
        {!lastExportedAt && (
          <p className="mt-1" style={{ fontSize: '11.5px', color: C.sub, lineHeight: 1.7 }}>
            {t.deleteConfirmNeverExportedDesc}
          </p>
        )}
      </div>

      <div className="mt-5" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <button
          onClick={onExportFirst}
          className="w-full py-3 text-sm font-bold"
          style={{ border: `1px solid ${C.ink}`, color: C.ink }}
        >
          {t.deleteConfirmExportFirstCta}
        </button>
        <div className="flex gap-2">
          <button
            onClick={onClose}
            className="flex-1 py-3 text-sm font-semibold"
            style={{ border: `1px solid ${C.line}`, color: C.ink }}
          >
            {t.cancel}
          </button>
          <button
            onClick={() => onConfirmDelete(scope)}
            className="flex-1 py-3 text-sm font-bold"
            style={{ backgroundColor: C.clay, color: '#FFFFFF' }}
          >
            {t.deleteConfirmDeleteCta}
          </button>
        </div>
      </div>
    </CenterDialog>
  );
}

// 只刪照片——一般 sheet 就好，這個動作留得住金額紀錄，破壞性比另外
// 兩種刪除小得多，不需要置中對話框那種「先停下來讀完」的重量級處理。
function DeletePhotosOnlySheet({ t, photoBytes, onClose, onConfirm }) {
  return (
    <BottomSheet onClose={onClose}>
      <p className="font-bold" style={{ fontSize: '15px', color: C.ink }}>
        {t.deletePhotosOnlyTitle}
      </p>
      <p className="mt-2" style={{ fontSize: '13px', color: C.sub, lineHeight: 1.8 }}>
        {t.deletePhotosOnlyDesc(formatBytes(photoBytes))}
      </p>
      <div className="mt-4 flex gap-2">
        <button
          onClick={onClose}
          className="flex-1 py-3 text-sm font-semibold"
          style={{ border: `1px solid ${C.line}`, color: C.ink }}
        >
          {t.cancel}
        </button>
        <button
          onClick={onConfirm}
          className="flex-1 py-3 text-sm font-bold"
          style={{ backgroundColor: C.clay, color: '#FFFFFF' }}
        >
          {t.deletePhotosOnlyCta}
        </button>
      </div>
    </BottomSheet>
  );
}

// 畫面 61：關於 Kaeru。三個 kaeru 那段是這頁的主體，用對照表而不是
// 散文——一句話講三個同音字會糊掉，三列一眼就看懂為什麼標誌是青蛙。
// 「不代辦退稅、不碰你的錢」要寫清楚：使用者裝一個退稅 App 的第一個
// 疑慮是「錢會不會經過你們」，這裡是回答這件事最合適的地方，比藏在
// 條款裡好。
function AboutSheet({ t, onClose, onOpenPrivacy }) {
  const rows = [
    { kanji: t.aboutKanji1, romaji: t.aboutRomaji1, meaning: t.aboutMeaning1, desc: t.aboutMeaningDesc1 },
    { kanji: t.aboutKanji2, romaji: t.aboutRomaji2, meaning: t.aboutMeaning2, desc: t.aboutMeaningDesc2 },
    { kanji: t.aboutKanji3, romaji: t.aboutRomaji3, meaning: t.aboutMeaning3, desc: t.aboutMeaningDesc3 },
  ];
  return (
    <FullScreenSheet>
      <div
        className="sticky top-0 z-10 flex items-center kaeru-pad"
        style={{
          backgroundColor: C.page,
          borderBottom: `1px solid ${C.ink}`,
          paddingTop: 'max(16px, env(safe-area-inset-top))',
          paddingBottom: '16px',
        }}
      >
        <button
          onClick={onClose}
          className="flex items-center gap-0.5 font-semibold"
          style={{ fontSize: '13px', color: C.blueDeep }}
        >
          <ChevronLeft size={15} />
          {t.settings}
        </button>
      </div>

      <div className="kaeru-pad py-6">
        <div className="flex items-center gap-3">
          <FrogMark size={52} />
          <div>
            <p className="font-bold" style={{ fontSize: '15px', letterSpacing: '0.3em', color: C.blueDeep }}>
              KAERU
            </p>
            <p className="mt-1 tabular-nums" style={{ fontSize: '11.5px', color: C.sub }}>
              {t.aboutVersion('1.0.0', APP_VERSION_DATE)}
            </p>
          </div>
        </div>

        <div className="mt-7" style={{ borderTop: `1px solid ${C.ink}`, paddingTop: '16px' }}>
          <SectionLabel>{t.aboutNameOriginKicker}</SectionLabel>
          <p className="mt-3" style={{ fontSize: '13px', color: C.ink, lineHeight: 1.9 }}>
            {t.aboutNameOriginDesc}
          </p>
          <div className="mt-2">
            {rows.map((r, i) => (
              <div
                key={i}
                className="flex items-baseline justify-between gap-3"
                style={{
                  padding: '14px 0',
                  borderBottom: i < rows.length - 1 ? `1px solid ${C.line}` : 'none',
                }}
              >
                <div className="flex items-baseline gap-2">
                  <span className="font-bold" style={{ fontSize: '19px', color: C.ink }}>
                    {r.kanji}
                  </span>
                  <span style={{ fontSize: '11px', color: C.sub }}>{r.romaji}</span>
                </div>
                <div className="text-right">
                  <p className="font-semibold" style={{ fontSize: '13.5px', color: C.ink }}>
                    {r.meaning}
                  </p>
                  <p className="mt-0.5" style={{ fontSize: '11px', color: C.sub }}>
                    {r.desc}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-7" style={{ borderTop: `1px solid ${C.ink}`, paddingTop: '16px' }}>
          <SectionLabel>{t.aboutWhatKicker}</SectionLabel>
          <p className="mt-3" style={{ fontSize: '13px', color: C.ink, lineHeight: 1.9 }}>
            {t.aboutWhatDesc}
          </p>
          <p className="mt-3" style={{ fontSize: '12.5px', color: C.sub, lineHeight: 1.85 }}>
            {t.aboutWhatBoundary}
          </p>
        </div>

        <div className="mt-6" style={{ backgroundColor: C.soft, padding: '14px' }}>
          <p className="font-bold" style={{ fontSize: '13px', color: C.ink }}>
            {t.aboutEstimateTitle}
          </p>
          <p className="mt-1.5" style={{ color: C.sub, fontSize: '11.5px', lineHeight: 1.8 }}>
            {t.aboutEstimateDesc}
          </p>
        </div>

        <div className="mt-6" style={{ borderTop: `1px solid ${C.line}`, paddingTop: '4px' }}>
          <button
            onClick={onOpenPrivacy}
            className="flex w-full items-center justify-between"
            style={{ padding: '14px 0', borderBottom: `1px solid ${C.line}` }}
          >
            <span style={{ fontSize: '14px', color: C.ink }}>{t.aboutPrivacyLink}</span>
            <ChevronRight size={14} style={{ color: C.sub }} />
          </button>
          <div className="flex items-center justify-between" style={{ padding: '14px 0' }}>
            <span style={{ fontSize: '14px', color: C.ink }}>{t.aboutFeedbackLabel}</span>
            <a
              href={`mailto:${t.aboutFeedbackEmail}`}
              style={{ fontSize: '12.5px', color: C.blueDeep }}
            >
              {t.aboutFeedbackEmail}
            </a>
          </div>
        </div>
      </div>
    </FullScreenSheet>
  );
}

// 畫面 56/57：隱私說明。白話版，不是條文——表格是這一頁的重點，一句
// 「我們重視你的隱私」沒有資訊量，六列各配一個標籤，使用者三秒就
// 掃完。標籤一律用線框，不要 clay 填色，這裡沒有一項是警示。
function PrivacyInfoSheet({ t, onClose, onOpenDataManage }) {
  const rows = [
    { label: t.privacyRowAmount, badge: t.privacyBadgeLocalOnly, tone: 'local' },
    { label: t.privacyRowPhotos, badge: t.privacyBadgeLocalOnly, tone: 'local' },
    { label: t.privacyRowTripSettings, badge: t.privacyBadgeLocalOnly, tone: 'local' },
    { label: t.privacyRowOcr, badge: t.privacyBadgeOnDevice, tone: 'local' },
    { label: t.privacyRowRate, badge: t.privacyBadgeConnects, sub: t.privacyRowRateSub, tone: 'connects' },
    { label: t.privacyRowAnalytics, badge: t.privacyBadgeNone, tone: 'local' },
  ];
  return (
    <FullScreenSheet>
      <div
        className="sticky top-0 z-10 flex items-center justify-between kaeru-pad"
        style={{
          backgroundColor: C.page,
          borderBottom: `1px solid ${C.ink}`,
          paddingTop: 'max(16px, env(safe-area-inset-top))',
          paddingBottom: '16px',
        }}
      >
        <button
          onClick={onClose}
          className="flex items-center gap-0.5 font-semibold"
          style={{ fontSize: '13px', color: C.blueDeep }}
        >
          <ChevronLeft size={15} />
          {t.settings}
        </button>
        <span style={{ fontSize: '11px', color: C.sub }}>
          {t.privacyUpdatedAt(PRIVACY_UPDATED_AT)}
        </span>
      </div>

      <div className="kaeru-pad py-6">
        <h1 className="font-bold" style={{ fontSize: '21px', color: C.ink }}>
          {t.privacyTitle}
        </h1>
        <p className="mt-2" style={{ fontSize: '13px', color: C.ink, lineHeight: 1.85 }}>
          {t.privacyIntro}
        </p>

        <div className="mt-5" style={{ borderTop: `1px solid ${C.ink}` }}>
          {rows.map((r, i) => (
            <div
              key={i}
              className="flex items-center justify-between gap-3"
              style={{ padding: '12px 0', borderBottom: `1px solid ${C.line}` }}
            >
              <div className="min-w-0">
                <p style={{ fontSize: '13.5px', color: C.ink }}>{r.label}</p>
                {r.sub && (
                  <p className="mt-0.5" style={{ fontSize: '11px', color: C.sub }}>
                    {r.sub}
                  </p>
                )}
              </div>
              <Badge tone="outline">{r.badge}</Badge>
            </div>
          ))}
        </div>

        <div className="mt-6">
          <SectionLabel>{t.privacyResultsKicker}</SectionLabel>
          <p className="mt-3" style={{ fontSize: '13px', color: C.ink, lineHeight: 1.85 }}>
            {t.privacyResultOffline}
          </p>
          <p className="mt-2 font-bold" style={{ fontSize: '13px', color: C.ink, lineHeight: 1.85 }}>
            {t.privacyResultDeleteApp}
          </p>
        </div>

        <button
          onClick={onOpenDataManage}
          className="mt-6 flex w-full items-center justify-between gap-3 text-left"
          style={{ backgroundColor: C.soft, padding: '14px' }}
        >
          <div>
            <p className="font-bold" style={{ fontSize: '13px', color: C.ink }}>
              {t.privacyExportBoxTitle}
            </p>
            <p className="mt-1" style={{ fontSize: '11.5px', color: C.sub }}>
              {t.privacyExportBoxDesc}
            </p>
          </div>
          <span
            className="shrink-0 font-bold"
            style={{ fontSize: '12.5px', color: C.blueDeep }}
          >
            {t.privacyExportBoxCta} ›
          </span>
        </button>

        <p className="mt-6" style={{ fontSize: '11.5px', color: C.sub, lineHeight: 1.85 }}>
          {t.privacyLegalNote}{' '}
          <a href={`mailto:${t.aboutFeedbackEmail}`} style={{ color: C.blueDeep }}>
            {t.aboutFeedbackEmail}
          </a>
          {t.privacyLegalNote.endsWith('。') ? '' : '。'}
        </p>
      </div>
    </FullScreenSheet>
  );
}

function MenuDropdown({
  t,
  lang,
  tab,
  trip,
  onClose,
  onGo,
  onAdd,
  onTrips,
  onLang,
}) {
  const rows = [
    ['home', Home],
    ['list', Rows3],
    ['check', ScanLine],
    ['faq', HelpCircle],
    ['set', Cog],
  ];

  const rowCls = 'flex w-full items-center gap-3 px-4 py-3 text-left';

  return (
    <>
      <style>{`@keyframes jpMenuIn{from{opacity:0;transform:translateY(-6px) scale(.98)}to{opacity:1;transform:none}}`}</style>

      <div className="fixed inset-0 z-30" onClick={onClose} />

      <div
        className="absolute right-0 z-40 overflow-hidden rounded-2xl"
        style={{
          top: 'calc(100% + 8px)',
          width: '17.5rem',
          maxWidth: 'calc(100vw - 2rem)',
          backgroundColor: C.card,
          border: `1px solid ${C.line}`,
          boxShadow: '0 12px 32px rgba(73,70,64,0.14)',
          transformOrigin: 'top right',
          animation: 'jpMenuIn 140ms ease-out',
        }}
      >
        <div className="p-3">
          <button
            onClick={onAdd}
            className="flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-semibold"
            style={{ backgroundColor: C.blue, color: '#FFFFFF' }}
          >
            <Plus size={16} /> {t.menuAdd}
          </button>
        </div>

        <div style={{ borderTop: `1px solid ${C.line}` }}>
          {rows.map(([k, Icon], i) => {
            const on = tab === k;
            return (
              <button
                key={k}
                onClick={() => onGo(k)}
                className={rowCls}
                style={{
                  borderTop: i === 0 ? 'none' : `1px solid ${C.line}`,
                  backgroundColor: on ? C.blueSoft : 'transparent',
                }}
              >
                <Icon
                  size={17}
                  style={{ color: on ? C.blue : C.sub }}
                  strokeWidth={on ? 2.2 : 1.7}
                />
                <span className="flex-1">
                  <span
                    className="block text-sm"
                    style={{ color: on ? C.blueDeep : C.ink }}
                  >
                    {t.nav[k]}
                  </span>
                  <span
                    className="mt-0.5 block text-xs leading-5"
                    style={{ color: C.sub }}
                  >
                    {t.navDesc[k]}
                  </span>
                </span>
              </button>
            );
          })}
        </div>

        <button
          onClick={onTrips}
          className={rowCls}
          style={{ borderTop: `1px solid ${C.line}` }}
        >
          <MapPin size={17} style={{ color: C.sub }} strokeWidth={1.7} />
          <span className="flex-1">
            <span className="block text-sm">{t.menuTrip}</span>
            <span className="mt-0.5 block text-xs" style={{ color: C.sub }}>
              {trip && trip.name ? trip.name : t.tripNow}
            </span>
          </span>
          <ChevronRight size={14} style={{ color: C.sub }} />
        </button>

        <button
          onClick={onLang}
          className={rowCls}
          style={{ borderTop: `1px solid ${C.line}` }}
        >
          <Globe size={17} style={{ color: C.sub }} strokeWidth={1.7} />
          <span className="flex-1 text-sm">{t.menuLang}</span>
          <span className="text-xs font-medium" style={{ color: C.blueDeep }}>
            {lang === 'zh' ? '日本語' : '中文'}
          </span>
        </button>
      </div>
    </>
  );
}

function TripSheet({
  t,
  trips,
  activeId,
  items,
  onClose,
  onSelect,
  onCreate,
  onDelete,
  onEditTrip,
}) {
  const [name, setName] = useState('');
  const [departure, setDeparture] = useState('');
  const [confirmId, setConfirmId] = useState(null);
  // 刪除確認掛進返回鍵堆疊——不掛的話,使用者在看到「確定要刪除嗎」
  // 那一刻按返回鍵，會直接跳過這層確認、關掉整層行程切換面板。
  useBackClose(confirmId, () => setConfirmId(null));

  const countOf = (id) => items.filter((i) => i.tripId === id).length;
  const fmtDep = (v) =>
    `${v.slice(0, 10).replace(/-/g, '/')} ${v.slice(11, 16)}`;
  const active = trips.find((x) => x.id === activeId);
  const others = [...trips]
    .filter((x) => x.id !== activeId)
    .sort((a, b) => (b.departure || '').localeCompare(a.departure || ''));

  return (
    <BottomSheet onClose={onClose}>
      <div className="flex items-center justify-between pb-4">
        <h2 className="font-bold" style={{ fontSize: '18px' }}>
          {t.trips}
        </h2>
        <button onClick={onClose} style={{ color: C.sub }}>
          <X size={20} />
        </button>
      </div>

      {active && (
        <div style={{ borderTop: `1px solid ${C.ink}`, paddingTop: '14px' }}>
          <button
            className="block w-full text-left"
            onClick={() => onEditTrip(active.id)}
          >
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-bold" style={{ fontSize: '17px' }}>
                {active.name || t.tripNow}
              </span>
              <Badge tone="blue">{t.tripNow}</Badge>
            </div>
            <p className="mt-1.5" style={{ color: C.sub, fontSize: '11.5px' }}>
              {countOf(active.id)} {t.tripReceipts}
              {active.departure
                ? ` · ${t.depPrefix} ${fmtDep(active.departure)}`
                : ` · ${t.noDeparture}`}
            </p>
          </button>

          {/* 只剩一個行程時不給刪，但不能完全不顯示——什麼都不說，使用者
              會以為介面壞了，猜不出是故意擋住。留一句說明講清楚規則跟
              解除方式（去新增一個），跟 TripEditSheet 的刪除保護同一套
              道理。 */}
          {trips.length <= 1 ? (
            <p className="mt-3" style={{ color: C.sub, fontSize: '11.5px', lineHeight: 1.7 }}>
              {t.tripDeleteMinNote}
            </p>
          ) : confirmId === active.id ? (
            <div
              className="mt-3"
              style={{
                backgroundColor: C.soft,
                borderLeft: `3px solid ${C.clay}`,
                padding: '12px 14px',
              }}
            >
              <p
                style={{
                  color: C.clayInk,
                  fontSize: '12.5px',
                  lineHeight: 1.7,
                }}
              >
                {t.deleteTripWarning(countOf(active.id))}
              </p>
              <div className="mt-2.5 flex gap-2">
                <button
                  onClick={() => {
                    onDelete(active.id);
                    setConfirmId(null);
                  }}
                  className="px-3 py-1.5 text-xs font-medium"
                  style={{
                    border: `1px solid ${C.clay}`,
                    color: C.clayInk,
                    borderRadius: 0,
                  }}
                >
                  {t.tripDelete}
                </button>
                <button
                  onClick={() => setConfirmId(null)}
                  className="px-3 py-1.5 text-xs"
                  style={{
                    border: `1px solid ${C.line}`,
                    color: C.ink,
                    borderRadius: 0,
                  }}
                >
                  {t.cancel}
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setConfirmId(active.id)}
              className="mt-3 flex w-full items-center justify-center py-2.5"
              style={{
                border: `1px solid ${C.line}`,
                color: C.sub,
                fontSize: '12.5px',
                borderRadius: 0,
              }}
            >
              {t.tripDelete}
            </button>
          )}
        </div>
      )}

      {others.length > 0 && (
        <div className="mt-6 pt-5" style={{ borderTop: `1px solid ${C.line}` }}>
          <SectionLabel>{t.tripPast}</SectionLabel>
          <div className="mt-1">
            {others.map((trip, idx) => (
              <div
                key={trip.id}
                className="flex items-baseline justify-between gap-3 py-3"
                style={idx > 0 ? { borderTop: `1px solid ${C.line}` } : {}}
              >
                <button
                  className="min-w-0 text-left"
                  onClick={() => onEditTrip(trip.id)}
                >
                  <p className="truncate" style={{ fontSize: '15px' }}>
                    {trip.name || t.tripNow}
                  </p>
                  <p
                    className="mt-0.5"
                    style={{ color: C.sub, fontSize: '11.5px' }}
                  >
                    {countOf(trip.id)} {t.tripReceipts}
                    {trip.departure &&
                      ` · ${t.depPrefix} ${fmtDep(trip.departure)}`}
                  </p>
                </button>
                <button
                  onClick={() => onSelect(trip.id)}
                  className="shrink-0"
                  style={{
                    color: C.blueDeep,
                    fontSize: '12.5px',
                    textDecoration: 'underline',
                  }}
                >
                  {t.tripSwitch}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mt-6 pt-5" style={{ borderTop: `1px solid ${C.ink}` }}>
        <SectionLabel>{t.newTrip}</SectionLabel>
        <div
          className="mt-4"
          style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}
        >
          <Input
            value={name}
            placeholder={`${t.tripName}　${t.tripNamePh}`}
            onChange={(e) => setName(e.target.value)}
          />
          <DateField
            withTime
            value={departure}
            onChange={setDeparture}
            t={t}
            fontSize="15px"
          />
          <button
            onClick={() => {
              if (!name.trim()) return;
              onCreate(name.trim(), departure);
              setName('');
              setDeparture('');
            }}
            disabled={!name.trim()}
            className="w-full py-3.5 text-sm font-semibold disabled:opacity-40"
            style={{
              backgroundColor: C.blue,
              color: '#FFFFFF',
              borderRadius: 0,
            }}
          >
            {t.create}
          </button>
        </div>
      </div>
    </BottomSheet>
  );
}

// 編輯行程：行程名稱／出發時間／出發機場／設為目前行程／這趟的收據統計／刪除行程
function TripEditSheet({
  t,
  trip,
  isActive,
  tripStats,
  tripCount,
  onClose,
  onSave,
  onDelete,
}) {
  const [name, setName] = useState(trip.name || '');
  const [departure, setDeparture] = useState(trip.departure || '');
  const [airport, setAirport] = useState(trip.airport || '');
  const [setActive, setSetActive] = useState(isActive);
  const [airportOpen, setAirportOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  useBackClose(airportOpen, () => setAirportOpen(false));
  // 刪除這趟行程的確認也掛進返回鍵堆疊，理由跟 TripSheet 的 confirmId 一樣。
  useBackClose(confirmDelete, () => setConfirmDelete(false));

  const airportInfo = AIRPORTS.find((a) => a.code === airport);

  const initialSnapshotRef = useRef(
    JSON.stringify({
      name: trip.name || '',
      departure: trip.departure || '',
      airport: trip.airport || '',
      setActive: isActive,
    }),
  );
  const isDirty =
    JSON.stringify({ name, departure, airport, setActive }) !==
    initialSnapshotRef.current;
  const guard = useDirtyBackGuard(isDirty, onClose);

  function save() {
    onSave({ name: name.trim(), departure, airport: airport || null }, setActive);
  }

  return (
    <>
      <FullScreenSheet>
        <div
          className="sticky top-0 z-10 flex items-center justify-between kaeru-pad"
          style={{
            backgroundColor: C.page,
            borderBottom: `1px solid ${C.ink}`,
            paddingTop: 'max(16px, env(safe-area-inset-top))',
            paddingBottom: '16px',
          }}
        >
          <button onClick={guard.requestClose} style={{ fontSize: '15px', color: C.sub }}>
            {t.cancel}
          </button>
          <h2 className="font-bold" style={{ fontSize: '15px' }}>
            {t.editTrip}
          </h2>
          <button
            onClick={save}
            className="font-bold"
            style={{ fontSize: '15px', color: C.blueDeep }}
          >
            {t.save}
          </button>
        </div>

        <div className="kaeru-pad py-6" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <Field label={t.tripName}>
            <Input
              value={name}
              placeholder={t.tripNamePh}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>

          <div>
            <Field label={t.departure}>
              <DateField withTime value={departure} onChange={setDeparture} t={t} fontSize="16px" />
            </Field>
            <p className="mt-2" style={{ color: C.sub, fontSize: '11.5px', lineHeight: 1.6 }}>
              {t.departureHint}
            </p>
          </div>

          <button
            onClick={() => setAirportOpen(true)}
            className="block w-full text-left"
            style={{ borderBottom: `1px solid ${C.line}`, paddingBottom: '10px' }}
          >
            <span
              className="block font-bold"
              style={{ color: C.blue, fontSize: '10.5px', letterSpacing: '0.22em' }}
            >
              {t.airport}
            </span>
            <span className="mt-2 flex items-center justify-between gap-2">
              <span style={{ fontSize: '16px', color: airportInfo ? C.ink : C.sub }}>
                {airportInfo ? `${airportInfo.name}　${airportInfo.code}` : t.airportPick}
              </span>
              <ChevronRight size={16} style={{ color: C.sub, flexShrink: 0 }} />
            </span>
          </button>

          <button
            onClick={() => setSetActive((v) => !v)}
            className="flex w-full items-center justify-between gap-3 text-left"
          >
            <span>
              <span className="block" style={{ fontSize: '15px', color: C.ink }}>
                {t.setActiveTrip}
              </span>
              <span className="mt-0.5 block" style={{ fontSize: '11.5px', color: C.sub }}>
                {t.setActiveTripHint}
              </span>
            </span>
            <span
              className="relative shrink-0"
              style={{
                width: '34px',
                height: '18px',
                backgroundColor: setActive ? C.blue : C.line,
              }}
            >
              <span
                className="absolute transition-transform"
                style={{
                  top: '2px',
                  left: '2px',
                  width: '14px',
                  height: '14px',
                  backgroundColor: '#FFFFFF',
                  transform: setActive ? 'translateX(16px)' : 'none',
                }}
              />
            </span>
          </button>

          <div style={{ borderTop: `1px solid ${C.ink}`, paddingTop: '18px' }}>
            <p
              className="font-bold"
              style={{ color: C.blue, fontSize: '10.5px', letterSpacing: '0.22em' }}
            >
              {t.tripReceiptsSection}
            </p>
            <div className="mt-3 flex items-baseline justify-between gap-2">
              <span style={{ fontSize: '15px', color: C.ink }}>
                {tripStats.count} {t.itemsUnit} · {t.inclTotalShort}
              </span>
              <span className="font-semibold tabular-nums" style={{ fontSize: '18px', color: C.ink }}>
                ¥{yen(tripStats.totalIncl)}
              </span>
            </div>
            {tripStats.count > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {tripStats.pending > 0 && (
                  <Badge tone="blue">{tripStats.pending}{t.statusPending}</Badge>
                )}
                {tripStats.refunded > 0 && (
                  <Badge tone="sage">{tripStats.refunded}{t.statusRefunded}</Badge>
                )}
                {tripStats.dead > 0 && (
                  <Badge tone="clay">{tripStats.dead}{t.statusDead}</Badge>
                )}
              </div>
            )}
          </div>

          <div style={{ borderTop: `1px solid ${C.line}`, paddingTop: '18px' }}>
            {/* 跟 TripSheet 的刪除保護一樣：只剩一個行程時不給刪——不然
                從設定頁或首頁空狀態的「編輯行程」CTA 進來，可以把唯一的
                行程刪掉，事後 app 會自己生一個空白行程頂替，使用者毫無
                預警。但完全不顯示刪除區塊、什麼都不說，使用者會以為
                介面壞了或東西不見了，猜不出是故意擋住——這裡改成留一句
                說明，讓使用者知道規則、也知道怎麼解除（去新增一個）。 */}
            {tripCount <= 1 ? (
              <p style={{ color: C.sub, fontSize: '12px', lineHeight: 1.8 }}>
                {t.tripDeleteMinNote}
              </p>
            ) : confirmDelete ? (
              <div style={{ backgroundColor: C.soft, borderLeft: `3px solid ${C.clay}`, padding: '12px 14px' }}>
                <p style={{ color: C.clayInk, fontSize: '12.5px', lineHeight: 1.7 }}>
                  {t.deleteTripWarning(tripStats.count)}
                </p>
                <div className="mt-2.5 flex gap-2">
                  {/* 灰赭實心填色按鈕整個 app 只留給照片刪除那個真正的破壞性
                      確認畫面用；行程刪除維持跟上面連結一致的線框樣式 */}
                  <button
                    onClick={onDelete}
                    className="px-3 py-1.5 text-xs font-medium"
                    style={{ border: `1px solid ${C.clay}`, color: C.clayInk }}
                  >
                    {t.tripDelete}
                  </button>
                  <button
                    onClick={() => setConfirmDelete(false)}
                    className="px-3 py-1.5 text-xs"
                    style={{ border: `1px solid ${C.line}`, color: C.ink }}
                  >
                    {t.cancel}
                  </button>
                </div>
              </div>
            ) : (
              <>
                <p style={{ color: C.sub, fontSize: '12px', lineHeight: 1.8 }}>
                  {t.deleteTripWarning(tripStats.count)}
                </p>
                <button
                  onClick={() => setConfirmDelete(true)}
                  className="mt-2"
                  style={{
                    color: C.clayInk,
                    fontSize: '15px',
                    borderBottom: `1px solid ${C.clay}`,
                    paddingBottom: '2px',
                  }}
                >
                  {t.tripDelete}
                </button>
              </>
            )}
          </div>
        </div>
      </FullScreenSheet>

      {airportOpen && (
        <AirportPickerSheet
          t={t}
          selected={airport}
          onClose={() => setAirportOpen(false)}
          onPick={(code) => {
            setAirport(code);
            setAirportOpen(false);
          }}
        />
      )}

      {guard.discardOpen && (
        <DiscardConfirmSheet
          t={t}
          onKeepEditing={guard.keepEditing}
          onDiscard={guard.discard}
        />
      )}
    </>
  );
}

// 畫面36：出境機場選擇。日本機場太多，不適合塞進下拉選單，改成獨立的
// 整頁選擇畫面：搜尋 + 依地區分組。清單只放主要國際線機場，找不到就
// 選「其他機場」（等於不選，套用預設 3 小時）。
function AirportPickerSheet({ t, selected, onClose, onPick }) {
  const [query, setQuery] = useState('');
  const sectionRefs = useRef({});

  const q = query.trim();
  const searching = q.length > 0;

  // 搜尋時是攤平的結果列表（不分組、不用籌碼跳轉，跟 37 號截圖一致）；
  // 沒搜尋時照地區分組，籌碼列可以點了跳到對應那組。
  const results = searching
    ? AIRPORTS.map((a) => {
        const cityText = a.citySearchLabel || a.city;
        const nameM = findMatch(a.name, q);
        const cityM = !nameM ? findMatch(cityText, q) : null;
        const codeM = !nameM && !cityM ? findMatch(a.code, q) : null;
        return { a, cityText, nameM, cityM, codeM, hit: !!(nameM || cityM || codeM) };
      }).filter((r) => r.hit)
    : null;

  const groups = !searching
    ? AIRPORT_REGIONS.map((region) => ({
        region,
        airports: AIRPORTS.filter((a) => a.region === region.key),
      })).filter((g) => g.airports.length > 0)
    : null;

  function scrollTo(key) {
    sectionRefs.current[key]?.scrollIntoView({ block: 'start' });
  }

  function row(a, extra) {
    const isSel = selected === a.code;
    return (
      <button
        key={a.code}
        onClick={() => onPick(a.code)}
        className="flex w-full items-center justify-between py-2.5 text-left"
        style={{ borderTop: `1px solid ${extra.first ? C.ink : C.line}` }}
      >
        <span className="min-w-0">
          <span
            className="block"
            style={{ fontSize: '14.5px', fontWeight: isSel ? 700 : 400, color: C.ink }}
          >
            <Highlight text={a.name} match={extra.nameM} />
          </span>
          <span className="mt-0.5 block" style={{ fontSize: '11px', color: C.sub }}>
            <Highlight text={extra.cityText || a.city} match={extra.cityM} /> · {t.arriveEarlyPrefix}{' '}
            {arriveHoursText(t, a.hours)}
            {extra.regionHeader && ` · ${extra.regionHeader}`}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-2.5">
          <span
            className="tabular-nums"
            style={{ fontSize: '12px', fontWeight: 700, color: C.sub, letterSpacing: '0.06em' }}
          >
            <Highlight text={a.code} match={extra.codeM} />
          </span>
          {isSel && <Badge tone="blue">{t.airportSelected}</Badge>}
        </span>
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-40 flex flex-col" style={{ backgroundColor: C.page, fontFamily: FONT }}>
      <div className="kaeru-app flex flex-1 flex-col" style={{ backgroundColor: C.page, minHeight: 0 }}>
        <div
          className="flex items-center justify-between kaeru-pad"
          style={{
            backgroundColor: C.page,
            borderBottom: `1px solid ${C.ink}`,
            paddingTop: 'max(18px, env(safe-area-inset-top))',
            paddingBottom: '14px',
          }}
        >
          <button
            onClick={onClose}
            className="flex items-center font-semibold"
            style={{ minWidth: '52px', minHeight: '44px', fontSize: '13px', color: C.blueDeep }}
          >
            ‹ {t.back}
          </button>
          <span className="font-bold" style={{ fontSize: '15px', color: C.ink }}>
            {t.airport}
          </span>
          <span style={{ width: '52px' }} />
        </div>

        <div className="kaeru-pad" style={{ paddingTop: '16px' }}>
          <div
            className="flex items-center justify-between"
            style={{ borderBottom: `1px solid ${C.line}`, paddingBottom: '9px' }}
          >
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t.airportSearchPh}
              className="w-full bg-transparent outline-none"
              style={{ border: 'none', fontSize: '15px', color: C.ink }}
            />
            {searching ? (
              <button onClick={() => setQuery('')} style={{ color: C.sub, flexShrink: 0 }}>
                <X size={15} />
              </button>
            ) : (
              <span style={{ fontSize: '12px', color: C.sub, flexShrink: 0 }}>⌕</span>
            )}
          </div>
          {searching ? (
            <p className="mt-2 tabular-nums" style={{ fontSize: '11.5px', color: C.sub }}>
              {t.airportResultCount(results.length)}
            </p>
          ) : (
            <p className="mt-2" style={{ fontSize: '11.5px', lineHeight: 1.75, color: C.sub }}>
              {t.airportSearchHint(AIRPORTS.length)}
            </p>
          )}
        </div>

        {!searching && (
          <div
            className="kaeru-pad no-scrollbar flex gap-1.5 overflow-x-auto"
            style={{ paddingTop: '12px', paddingBottom: '2px' }}
          >
            {AIRPORT_REGIONS.map((region) => (
              <button
                key={region.key}
                onClick={() => scrollTo(region.key)}
                className="shrink-0"
                style={{
                  fontSize: '12.5px',
                  padding: '6px 12px',
                  backgroundColor: C.soft,
                  border: `1px solid ${C.line}`,
                  color: C.sub,
                }}
              >
                {regionLabel(t, region, 'chip')}
              </button>
            ))}
          </div>
        )}

        <div className="kaeru-pad no-scrollbar flex-1 overflow-y-auto" style={{ minHeight: 0, paddingBottom: '8px' }}>
          {searching
            ? results.map(({ a, cityText, nameM, cityM, codeM }, i) =>
                row(a, {
                  first: i === 0,
                  cityText,
                  nameM,
                  cityM,
                  codeM,
                  regionHeader: regionLabel(
                    t,
                    AIRPORT_REGIONS.find((r) => r.key === a.region),
                    'header',
                  ),
                }),
              )
            : groups.map((g) => (
                <div
                  key={g.region.key}
                  ref={(el) => {
                    sectionRefs.current[g.region.key] = el;
                  }}
                  className="mt-3.5"
                >
                  <p
                    className="sticky font-bold"
                    style={{
                      top: 0,
                      backgroundColor: C.page,
                      color: C.blue,
                      fontSize: '10.5px',
                      letterSpacing: '0.22em',
                      paddingTop: '2px',
                      paddingBottom: '2px',
                    }}
                  >
                    {regionLabel(t, g.region, 'header')}
                  </p>
                  {g.airports.map((a, i) => row(a, { first: i === 0 }))}
                </div>
              ))}
        </div>

        <div
          className="kaeru-pad"
          style={{
            paddingTop: '14px',
            paddingBottom: 'max(28px, calc(env(safe-area-inset-bottom) + 16px))',
          }}
        >
          <p
            style={{
              borderTop: `1px solid ${C.ink}`,
              paddingTop: '13px',
              fontSize: '11.5px',
              lineHeight: 1.8,
              color: C.sub,
            }}
          >
            {searching ? t.airportItmNote : t.airportOtherHint}
          </p>
          <button
            onClick={() => onPick(null)}
            className="mt-2.5 font-semibold"
            style={{ fontSize: '13.5px', color: C.blueDeep }}
          >
            {t.airportOther} ›
          </button>
        </div>
      </div>
    </div>
  );
}

// 「拍照／從相簿選／掃描文件」整套流程的共用邏輯，EditSheet 跟 DetailSheet
// 都要能加照片，抽成 hook 避免兩邊各刻一份。setImgs 吃 functional updater
// （跟 useState 的 setter 同介面），EditSheet 傳真的 setState，DetailSheet
// 傳一個包了 onPhotosChange 的 wrapper（因為 DetailSheet 沒有「儲存」按鈕，
// 加/刪照片要立刻生效、直接寫回上層）。
function usePhotoCapture({
  imgs,
  setImgs,
  onParsed,
  librarySingleSelect,
  permissionPrimed,
  onPrimed,
}) {
  const [photoPromptOpen, setPhotoPromptOpen] = useState(false);
  const [photoDenied, setPhotoDenied] = useState(null); // null | 'camera' | 'photos'
  const [confirmPhoto, setConfirmPhoto] = useState(null); // { src, fromScan } | null
  // 第一次要用相機/相簿前的權限說明畫面（見 PermissionPrimeSheet）——
  // 只在 permissionPrimed 還是 false 時擋在 pickPhoto 前面一次，接受
  // 或拒絕都會讓呼叫端把 permissionPrimed 存成 true，之後不會再擋。
  const [primeOpen, setPrimeOpen] = useState(false);
  // openCamera/openLibrary/openScan 一開始就同步把 photoPromptOpen 設成
  // false，然後才 await 原生相機/相簿/掃描的結果——中間那段「原生還沒
  // 回來」的空檔，photoPromptOpen/confirmPhoto/photoDenied 全部都是空的，
  // 跟「使用者主動放棄、什麼都沒選」長得一模一樣。任何呼叫端如果拿這三
  // 個狀態去判斷「使用者是不是放棄了」，都會在這個空檔誤判。capturing
  // 就是用來把這個「原生呼叫還在進行中」的狀態明確標出來。
  const [capturing, setCapturing] = useState(false);
  const fileRef = useRef(null);
  const remaining = MAX_PHOTOS - imgs.length;
  useBackClose(photoPromptOpen, () => setPhotoPromptOpen(false));
  // 返回鍵當成「先不要」——一樣要記住已經說明過，不然退出去再點一次
  // 拍照，這個畫面又會跳出來一次，跟按「先不要」故意的效果不一致。
  useBackClose(primeOpen, () => declinePrime());
  // confirmPhoto（裁切畫面）的返回要先問「要放棄嗎」，不能直接關，
  // 交給 PhotoConfirmSheet 自己用 useBackClose 接（見該元件），這裡
  // 不重複註冊，否則兩邊會搶同一層。

  function isPermissionDenied(err) {
    if (!err) return false;
    const msg = String(err.message || err.code || '').toLowerCase();
    return msg.includes('permission') || msg.includes('denied');
  }

  // 權限說明畫面看過之後要恢復成什麼，有兩種：pickPhoto()（「+加
  // 照片」這類次要按鈕）非原生平台會直接點開純檔案選擇器；
  // openInitialPrompt()（QuickAddFlow 一進來就自動跳的那個）永遠要
  // 看到完整的三選一來源選單，不套用那個平台判斷的捷徑——快速新增
  // 的第一個畫面在原生裝置上本來就是完整選單，不能因為測試/開發
  // 環境是瀏覽器就變成另一種體驗。用這個 ref 記住這次是哪一種，
  // confirmPrime() 才知道「允許」之後該恢復成哪一個。
  const primeResumeRef = useRef(null); // 'menu' | null

  function openSourcePicker() {
    if (Capacitor.isNativePlatform()) {
      setPhotoPromptOpen(true);
      return;
    }
    fileRef.current && fileRef.current.click();
  }

  function confirmPrime() {
    setPrimeOpen(false);
    if (onPrimed) onPrimed();
    if (primeResumeRef.current === 'menu') {
      setPhotoPromptOpen(true);
    } else {
      openSourcePicker();
    }
    primeResumeRef.current = null;
  }

  // 「先不要，我自己手動輸入」——拒絕的路要留得體面，不是降級體驗。
  // 這裡不強迫開來源選單，單純記住「已經說明過」，讓使用者這次維持
  // 手動填寫；下次再點拍照/選圖，直接進正常流程，不會再看到這個畫面。
  function declinePrime() {
    setPrimeOpen(false);
    if (onPrimed) onPrimed();
    primeResumeRef.current = null;
  }

  async function onPick(e) {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    try {
      const src = await compressImage(f);
      // 每張新照片預設都是 'receipt'（憑證）——使用者不用在拍照/選圖
      // 前先決定型別，這個決定放在拍完之後，而且隨時可以改（見
      // retypeImg）。網頁版 file input 這條路徑沒有 OCR，無從判斷是
      // 不是收據，一律先當憑證，跟原生相機/掃描路徑的預設一致。
      setImgs((p) => [...p, { src, type: 'receipt' }].slice(0, MAX_PHOTOS));
    } catch (err) {}
    e.target.value = '';
  }

  function pickPhoto() {
    if (remaining <= 0) return;
    setPhotoDenied(null);
    // 第一次要用相機或相簿前出現的權限說明——不是 App 一開就跳，是
    // 使用者真的要拍照/選圖的這一刻才問。permissionPrimed 沒傳（例如
    // 網頁版還沒接這個流程）就當作已經看過，不擋。
    if (permissionPrimed === false) {
      primeResumeRef.current = null;
      setPrimeOpen(true);
      return;
    }
    openSourcePicker();
  }

  // QuickAddFlow 一進來就自動跳出來源選單那個效果專用——跟 pickPhoto()
  // 唯一的差異是「允許」之後永遠恢復成完整的三選一選單（見上面
  // primeResumeRef 的說明），不走 pickPhoto() 那條非原生平台直接開
  // 純檔案選擇器的捷徑。
  function openInitialPrompt() {
    setPhotoDenied(null);
    if (permissionPrimed === false) {
      primeResumeRef.current = 'menu';
      setPrimeOpen(true);
      return;
    }
    setPhotoPromptOpen(true);
  }

  async function openCamera() {
    setPhotoPromptOpen(false);
    setCapturing(true);
    try {
      // 用 Uri 不用 DataUrl：DataUrl 要原生端先把整張全解析度照片轉成
      // base64 字串才會把結果傳回來，拍完之後那段「等」就是卡在這裡。
      // Uri 原生端只回一個檔案路徑，幾乎是瞬間的，確認/裁切畫面能馬上
      // 顯示；真的需要 base64（存檔、辨識）的地方再各自轉，且那些都
      // 可以在背景做，不用擋著使用者看到照片。
      const shot = await Camera.getPhoto({
        resultType: CameraResultType.Uri,
        source: CameraSource.Camera,
        quality: 80,
      });
      if (shot?.webPath) {
        setConfirmPhoto({ src: shot.webPath, fromScan: false });
      } else {
        // 極少數情況下原生端會「成功回來、卻沒給可用的路徑」——不是
        // 使用者取消（那個會直接拋錯，走下面的 catch），也不是權限被
        // 拒，是真的拍完了、卻拿不到照片。什麼都不做的話，QuickAddFlow
        // 那個「使用者是不是放棄了」的判斷會把這個狀態誤判成「使用者
        // 什麼都沒選」，直接把整條快路關掉、跳回首頁——使用者完全不
        // 知道剛剛發生了什麼事，也不知道剛拍的照片去哪了。這應該就是
        // 「拍完就跳、跳回首頁」這個 bug 的成因：拍照這一步本身沒有
        // 拋錯，只是沒拿到可用的照片。改成重新跳出來源選單，讓使用者
        // 能馬上再試一次，不要默默把人踢回首頁。
        setPhotoPromptOpen(true);
      }
    } catch (err) {
      if (isPermissionDenied(err)) setPhotoDenied('camera');
    } finally {
      setCapturing(false);
    }
  }

  async function openLibrary() {
    setPhotoPromptOpen(false);
    setCapturing(true);
    try {
      // pickImages 是舊版 API，已標記 deprecated，多選在部分裝置上不
      // 可靠；chooseFromGallery 才是目前真的支援多選的方法，要自己開
      // allowMultipleSelection，不然預設是單選。
      // librarySingleSelect（快速新增用）：那個畫面全程只顯示、只用
      // 得到第一張——選多張的話，第 2 張之後會直接被存進去、標成收據
      // 照片，但畫面上完全看不到，使用者沒機會看、改型別或刪除，等於
      // 悄悄多存了幾張自己不知道的照片。快速新增本來就是「一張收據、
      // 一張照片」的設計，這裡直接限制成單選，不留這個坑；完整表單／
      // 詳情頁的「+加照片」有完整的縮圖管理畫面，維持原本可以多選。
      const picked = await Camera.chooseFromGallery({
        allowMultipleSelection: !librarySingleSelect,
        limit: librarySingleSelect ? 1 : Math.max(1, remaining),
        quality: 80,
      });
      const files = picked?.results || [];
      if (!files.length) return;
      // 第一張要走跟拍照/掃描同一條路——PhotoConfirmSheet 的確認畫面，
      // 順便跑 OCR——不能直接加進 imgs 就算了事。這裡曾經漏掉這一步，
      // 從相簿選的照片永遠不會跑 OCR，QuickAddFlow 完全靠第一張的 OCR
      // 結果決定要不要跳「這張看起來不像收據」那個分支（見
      // looksLikeReceiptText／notAReceipt）；漏了 OCR，判斷永遠拿到
      // null，不管選的到底是不是收據，一律掉進「金額沒讀到、要手動
      // 填」那條路，連稅率都要使用者自己選——明明畫面上該問的是「這是
      // 收據還是物品照片」，卻在問「8% 還是 10%」，是同一個根因。剩下
      // 選的幾張（如果有；librarySingleSelect 時不會有）才直接加，不
      // 用每張都跳一次確認畫面。
      const [first, ...rest] = files;
      const firstSrc = first.webPath || first.uri;
      if (firstSrc) {
        setConfirmPhoto({ src: firstSrc, fromScan: false });
      } else {
        // 使用者真的選了照片（files.length > 0，不是取消選圖那種
        // 情況），但原生端給的這張缺路徑可用——跟 openCamera 那邊同一
        // 個坑，什麼都不做會被「使用者是不是放棄了」那個判斷誤判成
        // 沒選任何東西，整條快路悄悄關掉。重新跳出來源選單讓使用者
        // 能馬上再選一次。
        setPhotoPromptOpen(true);
      }
      // 第一張以外的照片不會經過 PhotoConfirmSheet，本來完全沒有機會
      // 跑 OCR，一律硬標成 'receipt'——食物、飲料、店面這種明顯不是
      // 收據的照片，一樣被歸類成收據照片，使用者才會覺得「怎麼都跑到
      // 收據那邊」。這裡補上跟第一張同一套判斷（見 guessPhotoType），
      // 猜錯的話使用者長按縮圖還是能改，不是最終定案，但猜一次總比
      // 完全不猜、每張都當收據好。
      for (const f of rest.slice(0, Math.max(0, remaining - 1))) {
        try {
          const src = await compressImageSrc(f.webPath || f.uri);
          const type = await guessPhotoType(src);
          setImgs((p) => (p.length < MAX_PHOTOS ? [...p, { src, type }] : p));
        } catch (err) {
          // 這裡失敗過去完全靜默——使用者只會發現「選了 3 張卻只存進
          // 2 張」，卻沒有任何線索可以回報。印出來，下次用 chrome://
          // inspect 接上就能看到是哪一張、為什麼失敗。
          console.error('[usePhotoCapture] 相簿多選：附加照片失敗', err);
        }
      }
    } catch (err) {
      if (isPermissionDenied(err)) setPhotoDenied('photos');
    } finally {
      setCapturing(false);
    }
  }

  async function openScan() {
    setPhotoPromptOpen(false);
    setCapturing(true);
    try {
      const res = await ReceiptScanner.scanDocument();
      const images = res?.images || [];
      if (!images.length) return;
      const [first, ...rest] = images;
      setConfirmPhoto({ src: first, fromScan: true });
      // remaining 是「開始掃描那一刻」還剩幾張額度，第一頁留給確認/
      // 裁切畫面用，其他頁最多再補 remaining-1 張——如果那時候額度已經
      // 是 0（滿額才點掃描），remaining-1 會是負數，array.slice(0,-1)
      // 在 JS 裡的意思是「除了最後一項」，不是「空陣列」，要用
      // Math.max(0, ...) 夾住，不然滿額時點掃描還是會多塞幾張進來。
      for (const raw of rest.slice(0, Math.max(0, remaining - 1))) {
        try {
          const src = await compressImageSrc(raw);
          const type = await guessPhotoType(src);
          setImgs((p) => (p.length < MAX_PHOTOS ? [...p, { src, type }] : p));
        } catch (err) {
          console.error('[usePhotoCapture] 掃描文件：附加照片失敗', err);
        }
      }
    } catch (err) {
      if (isPermissionDenied(err)) setPhotoDenied('camera');
    } finally {
      setCapturing(false);
    }
  }

  // looksLikeReceipt 是 PhotoConfirmSheet 那邊算好的粗略判斷（有沒有
  // 一串數字、有沒有橫向文字列），跟 parsed（結構化解析結果）一起轉
  // 交給呼叫端決定要不要跳「這張看起來不像收據」的分支（見
  // QuickAddFlow）。這裡也拿它來決定新照片的預設型別，但不能只看
  // looksLikeReceipt——跟 QuickAddFlow 判斷 notAReceipt 用同一套邏輯：
  // 只要真的抓到金額（incl／incl8／incl10），就是比 looksLikeReceipt
  // 更強的證據，優先蓋過去，維持當收據；否則才看 looksLikeReceipt，
  // 是 false 才預設當物品照片。沒有這一步的話，理論上會出現「明明讀到
  // 金額、QuickAddFlow 判定是收據，這裡卻把型別猜成物品照片」這種
  // 兩邊互相矛盾的情況（雖然實務上少見，因為金額規則本身就需要「合計/
  // 対象」這類關鍵字或 円/¥ 符號，跟 looksLikeReceipt 判斷的訊號高度
  // 重疊，但邏輯上兩者是分開算的，不該假設它們永遠一致）。這個預設
  // 不是定案，使用者長按縮圖隨時可以改；在 QuickAddFlow 裡，如果這張
  // 後來被判定「不像收據」，使用者選「還是當收據」的話，QuickAddFlow
  // 自己會再把型別改回 'receipt'（見 keepAsReceipt），這裡不用特別
  // 處理那個情況。
  function finishConfirm(src, parsed, looksLikeReceipt) {
    setConfirmPhoto(null);
    // src 是 null 代表使用者直接關掉確認畫面、沒有真的「使用這張」
    // （見 PhotoCaptureSheets 的 onClose）——這種情況連 OCR 都沒真的
    // 跑完就被關掉了，parsed/looksLikeReceipt 這兩個參數根本沒傳，
    // 不能呼叫 onParsed，否則呼叫端會收到 (undefined, undefined)，
    // 跟「這張真的辨識完、什麼都沒讀到」的 (null, false) 混在一起，
    // 兩件不一樣的事又變成分不出來。
    if (!src) return;
    const hasAmountSignal = !!(parsed && (parsed.incl || parsed.incl8 || parsed.incl10));
    const type = !hasAmountSignal && looksLikeReceipt === false ? 'item' : 'receipt';
    setImgs((p) => (p.length < MAX_PHOTOS ? [...p, { src, type }] : p));
    if (onParsed) onParsed(parsed, looksLikeReceipt);
  }

  // 重拍：關掉目前的確認畫面、重新跳一次來源選單。中間夾了
  // deferOpen（避免 confirmPhoto 那層 history.back() 跟重新
  // pickPhoto() 的 pushState 同一 tick 搶跑），這段空檔跟原生呼叫
  // 還沒回來的空檔是同一種「看起來像放棄，其實不是」的狀態，一樣
  // 靠 capturing 標起來，等真的重新跳出選單（或使用者這次真的沒選
  // 東西）才放開。
  function retake() {
    setCapturing(true);
    setConfirmPhoto(null);
    deferOpen(() => {
      setCapturing(false);
      pickPhoto();
    });
  }

  function removeImg(idx) {
    setImgs((p) => p.filter((_, i) => i !== idx));
  }

  // 型別隨時可改（長按縮圖切換，見 PhotoAttachments）——跟刪除一樣
  // 用 index 定位，不用整包物件比對，photos 陣列裡本來就可能有兩張
  // 內容一模一樣的照片（使用者重複拍了兩次），用內容比對會兩張一起
  // 改到。
  function retypeImg(idx, type) {
    setImgs((p) => p.map((item, i) => (i === idx ? { ...item, type } : item)));
  }

  return {
    photoPromptOpen,
    setPhotoPromptOpen,
    photoDenied,
    confirmPhoto,
    capturing,
    fileRef,
    remaining,
    onPick,
    pickPhoto,
    openInitialPrompt,
    openCamera,
    openLibrary,
    openScan,
    finishConfirm,
    retake,
    removeImg,
    retypeImg,
    primeOpen,
    confirmPrime,
    declinePrime,
  };
}

// 共用的「來源選擇面板」＋「確認/裁切畫面」，接 usePhotoCapture 回傳的 cap。
// onConfirmCancelled 是選填的——只有 QuickAddFlow 需要，見下面該元件裡
// 的說明；EditSheet／DetailSheet 不傳，維持原本「關掉確認畫面就回表單」
// 的行為不變。
// 畫面 55：權限說明。第一次要用相機或相簿前出現，不是 App 一開就跳
// ——使用者對相簿權限的預設懷疑是「你要拿去幹什麼」，「就這樣。沒有
// 第三步」把清單封口比多寫三行保證有效。拒絕的路要留得體面：照片本
// 來就是選填的，「先不要」不是降級體驗，不用警告語氣、不用 clay。
function PermissionPrimeSheet({ t, onAllow, onDecline }) {
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

function PhotoCaptureSheets({ t, cap, onConfirmCancelled }) {
  return (
    <>
      {cap.primeOpen && (
        <PermissionPrimeSheet t={t} onAllow={cap.confirmPrime} onDecline={cap.declinePrime} />
      )}

      {cap.photoPromptOpen && (
        <BottomSheet onClose={() => cap.setPhotoPromptOpen(false)}>
          <div className="flex items-center justify-between">
            <h2 className="font-bold" style={{ fontSize: '18px' }}>
              {t.photo}
            </h2>
            <button onClick={() => cap.setPhotoPromptOpen(false)} style={{ color: C.sub }}>
              <X size={18} />
            </button>
          </div>
          <p className="mt-1.5" style={{ color: C.sub, fontSize: '11.5px' }}>
            {t.photoSheetSub}
          </p>
          <div className="mt-3">
            {[
              { label: t.takePhotoOption, hint: t.takePhotoHint, onClick: cap.openCamera },
              { label: t.chooseFromLibrary, hint: t.libraryHint, onClick: cap.openLibrary },
              { label: t.scanDoc, hint: t.scanDocHint, onClick: cap.openScan },
            ].map((opt, i) => (
              <button
                key={opt.label}
                onClick={opt.onClick}
                className="flex w-full items-center justify-between py-4 text-left"
                style={{ borderTop: `1px solid ${i === 0 ? C.ink : C.line}` }}
              >
                <span>
                  <span className="block font-bold" style={{ fontSize: '15px', color: C.ink }}>
                    {opt.label}
                  </span>
                  <span className="block" style={{ fontSize: '11.5px', color: C.sub }}>
                    {opt.hint}
                  </span>
                </span>
                <ChevronRight size={14} style={{ color: C.sub, flexShrink: 0 }} />
              </button>
            ))}
          </div>
          <div className="mt-1 flex justify-center py-3" style={{ borderTop: `1px solid ${C.ink}` }}>
            <button
              onClick={() => cap.setPhotoPromptOpen(false)}
              className="font-semibold"
              style={{ color: C.sub, fontSize: '13.5px' }}
            >
              {t.cancel}
            </button>
          </div>
        </BottomSheet>
      )}

      {cap.confirmPhoto && (
        <PhotoConfirmSheet
          t={t}
          src={cap.confirmPhoto.src}
          fromScan={cap.confirmPhoto.fromScan}
          onRetake={cap.retake}
          onUse={cap.finishConfirm}
          onClose={() => {
            cap.finishConfirm(null);
            if (onConfirmCancelled) onConfirmCancelled();
          }}
        />
      )}
    </>
  );
}

// 「+」的快路：拍照→OCR→存起來，晚點再補，跟完整表單並行存在，不取代
// 它。內部重用跟 EditSheet／DetailSheet 同一份 usePhotoCapture／
// PhotoCaptureSheets 拍照/選相簿/掃描/裁切/OCR 邏輯，外面包一個完全不同
// 的迷你表單——沒有店名/日期輸入框，也不能選稅率，OCR 讀到什麼就是
// 什麼，讀不到就掛「待補」標籤。
function QuickAddFlow({
  t,
  onClose,
  onSaveQuick,
  onSaveFull,
  photoPermissionPrimed,
  onPhotoPermissionPrimed,
}) {
  const [imgs, setImgs] = useState([]);
  const [parsed, setParsed] = useState(null);
  const [refundMethod, setRefundMethod] = useState(null); // 必答，故意不預選
  // OCR 讀不到金額時的手動補值。跟 parsed 分開放，是因為 parsed 代表
  // 「這次照片辨識出來的東西」，手動輸入是使用者自己補的，兩者來源不
  // 一樣；分開放也才能讓「OCR 讀到了」跟「使用者自己填的」在畫面上
  // 走不同的呈現方式（見下面 amountFound 分支）。
  const [manualIncl, setManualIncl] = useState('');
  const [manualRate, setManualRate] = useState(null); // 讀不到稅率不能預設 10%，要使用者自己選
  // OCR 連「像不像收據」這個最低標準都判斷不出來——這種情況不能沉默
  // 失敗，要主動問使用者這張到底是什麼，見下面的「不像收據」分支。
  const [notAReceipt, setNotAReceipt] = useState(false);
  const openedRef = useRef(false);
  const cap = usePhotoCapture({
    imgs,
    setImgs,
    onParsed: (p, looksLikeReceipt) => {
      setParsed(p);
      // 這裡曾經寫成 !p && !looksLikeReceipt——只要 parsed 不是 null 就
      // 不算「不像收據」。問題是 parseReceiptOCR 的店名判斷很鬆（隨便
      // 一行 2~20 字、沒有數字的文字就算店名），拿一張桌面截圖去跑，
      // 隨便一個視窗標題、按鈕文字都可能被誤認成「店名」，parsed 就
      // 不是 null 了——即使 looksLikeReceipt 已經正確判斷「不像收據」，
      // 也會被這個誤判蓋過去，實際測到真的發生了（拍桌面截圖，抓到
      // "CLAUDE" 當店名，looksLikeReceipt: false，卻還是掉進「金額
      // 待補」畫面，不是「不像收據」畫面）。
      // 只有真的抓到金額（incl／incl8／incl10）才算夠強的證據可以
      // 蓋過 looksLikeReceipt 的判斷——店名、日期都是用寬鬆規則猜的，
      // 猜到不代表這真的是收據，不能拿來否決「不像收據」這個結論。
      const hasAmountSignal = !!(p && (p.incl || p.incl8 || p.incl10));
      setNotAReceipt(!hasAmountSignal && !looksLikeReceipt);
    },
    // 這個畫面全程只顯示、只用得到第一張照片——選相簿限制成單選，不然
    // 選第 2 張以後的照片會悄悄存進去、卻沒有任何畫面能看到/改型別。
    librarySingleSelect: true,
    permissionPrimed: photoPermissionPrimed,
    onPrimed: onPhotoPermissionPrimed,
  });
  // 這裡不用另外掛一層 useBackClose——整個快路（從開始到存檔／取消）
  // 在使用者心裡是同一個任務，外層 App 已經用 quickAddOn 掛了一層；
  // 裡面的來源選單／裁切畫面各自用 usePhotoCapture／PhotoConfirmSheet
  // 自己的 back-close，不用再包一層，否則同一個任務會被分成兩層，
  // 使用者要按兩次返回鍵才能真的離開。

  // 一進來就直接跳「拍照/選相簿/掃描」選單，不用使用者再多按一次——
  // 快路的整個意義就是「拍照優先」。使用者如果把這個選單整個關掉、
  // 也沒有進到裁切畫面，代表根本不想拍，直接退出整條快路。
  useEffect(() => {
    if (!openedRef.current) {
      openedRef.current = true;
      // 用 openInitialPrompt()，不要直接 setPhotoPromptOpen(true)——
      // 第一次要用相機/相簿前要先看過權限說明（見 usePhotoCapture），
      // 直接開 photoPromptOpen 會跳過這一關；也不要用 pickPhoto()，
      // 那個給「+加照片」這類次要按鈕用，非原生平台會直接開純檔案
      // 選擇器，快速新增一進來永遠要看到完整的三選一選單。
      cap.openInitialPrompt();
      return;
    }
    // 相機/相簿權限被拒時要讓使用者看得到原因、有機會去設定開啟，
    // 不能默默把整條快路關掉——那樣使用者永遠不知道發生了什麼事。
    // cap.capturing 一定要排除掉：openCamera/openLibrary/openScan 一
    // 開始就同步把 photoPromptOpen 設成 false，然後才 await 原生結果，
    // 那段「原生還沒回來」的空檔，跟真的什麼都沒選、放棄整條快路，從
    // 這四個狀態看起來一模一樣——沒有這個旗標的話，點「拍照」的當下
    // 就會被這裡誤判成放棄，直接把整條快路關掉，原生相機根本還沒跳
    // 出來。cap.primeOpen 也要排除：權限說明畫面開著的時候一樣不算
    // 放棄，那是流程的一部分，不是使用者關掉整個選單。
    if (
      !imgs.length &&
      !cap.photoPromptOpen &&
      !cap.confirmPhoto &&
      !cap.photoDenied &&
      !cap.capturing &&
      !cap.primeOpen
    ) {
      onClose();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    cap.photoPromptOpen,
    cap.confirmPhoto,
    cap.photoDenied,
    cap.capturing,
    cap.primeOpen,
    imgs.length,
  ]);

  if (!imgs.length) {
    return (
      <>
        {/* onConfirmCancelled：使用者在確認/裁切畫面按返回鍵（那個畫面
            沒有 ✕，只有「重拍」跟「使用」，返回鍵是唯一的退出方式，
            而且還沒調過裁切框的話不會問「要放棄嗎」，直接就關）——
            關掉那個畫面之後，這個分支（imgs.length 還是 0）什麼都
            不會顯示，下面那個「使用者是不是放棄了」的判斷會把這個
            狀態誤判成「使用者根本沒選、直接關掉整個選單」，把整條快
            路關掉，剛拍好的照片就這樣不見了，回到首頁。這裡改成重新
            跳出來源選單，讓使用者可以馬上選別的來源，不會被丟回首頁。 */}
        <PhotoCaptureSheets
          t={t}
          cap={cap}
          onConfirmCancelled={() => cap.setPhotoPromptOpen(true)}
        />
        {cap.photoDenied && !cap.photoPromptOpen && !cap.confirmPhoto && (
          <BottomSheet onClose={onClose}>
            <p style={{ fontSize: '13px', color: C.ink, lineHeight: 1.9 }}>
              {cap.photoDenied === 'camera' ? t.cameraDenied : t.photoDenied}
              {'　'}
              <button
                onClick={() => ReceiptScanner.openAppSettings().catch(() => {})}
                style={{ color: C.blueDeep, textDecoration: 'underline' }}
              >
                {t.openSettings}
              </button>
            </p>
          </BottomSheet>
        )}
      </>
    );
  }

  const mixed = parsed?.rate === 'mixed';
  const v8 = mixed ? parsed.incl8 || 0 : 0;
  const v10 = mixed ? parsed.incl10 || 0 : 0;
  // amountFound 只反映「這次照片辨識到底有沒有讀到金額」，不受使用者
  // 事後手動輸入影響——拿來決定照片標籤（讀到金額了 sage／沒讀到金額
  // clay）跟要不要跳「不像收據」分支，是這張照片本身的、存檔後也不會
  // 變的事實。
  const ocrIncl = mixed ? v8 + v10 : parsed?.incl || 0;
  const amountFound = ocrIncl > 0;
  // 使用者在「不像收據」分支選過「存成物品照片」之後，這張的型別會
  // 變成 'item'——這時候照片標籤不能再顯示「沒讀到金額」，那句話的
  // 語意是「試過了、沒讀到」，但使用者已經確認過這根本不是收據，繼續
  // 講「沒讀到金額」等於沒把剛剛那個確認當一回事，要換成反映「這是
  // 物品照片」這個目前狀態的標籤。
  const photoIsItem = imgs[0]?.type === 'item';
  const manualInclNum = Number(manualIncl.replace(/,/g, '')) || 0;
  const incl = amountFound ? ocrIncl : manualInclNum;
  // 稅率同理：OCR 讀不到金額的收據，稅率通常也沒讀到，不能偷偷預設
  // 10%——8% 跟 10% 會讓退款金額差到一截，猜錯比留白讓使用者選更糟。
  const rate = amountFound ? (mixed ? 'mixed' : parsed?.rate ?? 10) : manualRate;
  // amountReady 是「金額跟稅率現在都有了」，不管是 OCR 讀到的還是使用
  // 者剛剛自己填的——這個決定畫面要顯示摘要卡還是手動輸入表單，跟上面
  // amountFound（純粹 OCR 有沒有讀到）是兩件事：使用者自己填完之後，
  // 畫面應該跟 OCR 一次就讀到長一樣，不用因為「這是手填的」就繼續掛著
  // 輸入表單不放。
  const amountReady = incl > 0 && (mixed || !!rate);
  const net = mixed
    ? netOf(v8, 8) + netOf(v10, 10)
    : amountReady
      ? netOf(incl, rate || 10)
      : 0;
  const tax = incl - net;
  const metThreshold = net >= 5000;
  const rateLabel = mixed ? '8% + 10%' : `${rate}`;
  // 退款方式一定要選。金額現在可以先留白（「只有照片、金額待補」也要
  // 能存——見 CLAUDE_CODE_DELTA_照片型別.md 第 1 節），但只要使用者已經
  // 開始填金額，就要連稅率也一起選好才能存，不能存一筆有金額、卻用猜
  // 的稅率去算退稅的收據——半填不完整、猜稅率，都不如乾脆留白待補。
  const canSave = !!refundMethod && (incl <= 0 || amountReady);

  function retake() {
    setParsed(null);
    setNotAReceipt(false);
    setManualIncl('');
    setManualRate(null);
    setImgs([]);
    cap.setPhotoPromptOpen(true);
  }

  // 「不像收據」分支的三顆動作之二、三——「存成物品照片」把這張改標成
  // 'item'（不再參與 OCR／金額），"還是當收據" 把型別改回 'receipt'
  // 再關掉這個分支、留在原本「讀不到，手動補」那條路。這張進來的時候
  // （見 finishConfirm）如果 OCR 已經猜過是「不像收據」，型別會先被
  // 猜成 'item'——使用者在這裡明確選了「還是當收據」，就要把這個猜測
  // 改回來，不然畫面上明明說「當收據」，型別卻還是物品照片，兩者對
  // 不起來。
  function saveAsItemPhoto() {
    cap.retypeImg(0, 'item');
    setNotAReceipt(false);
  }
  function keepAsReceipt() {
    cap.retypeImg(0, 'receipt');
    setNotAReceipt(false);
  }

  function buildDraft() {
    return {
      shop: parsed?.shop || '',
      date: parsed?.date || todayStr(),
      incl,
      // 稅率沒選就存 null，不要偷偷猜 10%——三顆稅率按鈕一顆都沒點也
      // 能存（見上面新加的那一列），存起來的資料要跟畫面上「稅率待選」
      // 那個標籤講的是同一件事，不能畫面說「還沒選」、存檔卻默默填了
      // 10%。DetailSheet 顯示這一欄時要對應處理 null（見那邊的修改）。
      rate: mixed ? 'mixed' : rate || null,
      incl8: mixed ? v8 || null : null,
      incl10: mixed ? v10 || null : null,
      refundMethod: refundMethod || 'unsure',
    };
  }

  // 「這張看起來不像收據」——OCR 連最低標準都判斷不出來時，不要沉默
  // 失敗（那就是「¥0」那個 bug 的變體），主動給使用者三個出路，把誤
  // 操作變成一個有用的分支，不是一句錯誤訊息。這裡完全是另一種畫面
  // （沒有存起來的標題列按鈕——三個動作選一個之前，這張收據到底要不
  // 要當收據都還沒決定，沒有「先存」這個選項），所以整個提前 return，
  // 不跟下面主畫面共用同一棵 JSX。
  if (notAReceipt) {
    return (
      <FullScreenSheet>
        <div
          className="sticky top-0 z-10 flex items-center justify-between kaeru-pad"
          style={{
            backgroundColor: C.page,
            borderBottom: `1px solid ${C.ink}`,
            paddingTop: 'max(16px, env(safe-area-inset-top))',
            paddingBottom: '16px',
          }}
        >
          <button onClick={onClose} style={{ fontSize: '13px', color: C.sub }}>
            {t.cancel}
          </button>
          <h2 className="font-bold" style={{ fontSize: '15px' }}>
            {t.quickAddTitle}
          </h2>
          {/* 沒有「存起來」——用同寬度的隱形文字撐開版面，標題才會跟
              有存檔按鈕的畫面（46/49）落在同一個水平位置，不是特例。 */}
          <span
            aria-hidden="true"
            style={{ fontSize: '13px', color: 'transparent', userSelect: 'none' }}
          >
            {t.quickAddSave}
          </span>
        </div>

        <div
          className="kaeru-pad py-6"
          style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}
        >
          <div>
            <div
              className="mx-auto flex items-center justify-center"
              style={{
                width: '100%',
                maxWidth: '196px',
                height: '196px',
                backgroundColor: C.soft,
                border: `1px solid ${C.line}`,
              }}
            >
              <div
                className="flex items-center justify-center"
                style={{
                  width: '132px',
                  height: '132px',
                  borderRadius: '16px',
                  backgroundColor: C.blueSoft,
                }}
              >
                <ImageIcon size={46} style={{ color: C.sub }} strokeWidth={1.5} />
              </div>
            </div>
            <div className="mt-3 flex flex-wrap justify-center gap-1.5">
              <Badge tone="clay">{t.quickAddNotReceiptBadge}</Badge>
            </div>
          </div>

          <div>
            <h3 className="font-bold" style={{ fontSize: '19px', color: C.ink }}>
              {t.quickAddNotReceiptTitle}
            </h3>
            <p className="mt-2" style={{ fontSize: '13px', color: C.sub, lineHeight: 1.8 }}>
              {t.quickAddNotReceiptDesc}
            </p>
          </div>

          <div style={{ borderTop: `1px solid ${C.ink}`, paddingTop: '18px' }}>
            <SectionLabel>{t.quickAddNotReceiptWhatLabel}</SectionLabel>
            <ol className="mt-4" style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              {[t.quickAddNotReceiptTip1, t.quickAddNotReceiptTip2, t.quickAddNotReceiptTip3].map(
                (tip, i) => (
                  <li key={i} className="flex gap-4">
                    <span
                      className="shrink-0 font-bold tabular-nums"
                      style={{ color: C.blue, opacity: 0.7, fontSize: '12px' }}
                    >
                      {String(i + 1).padStart(2, '0')}
                    </span>
                    <p style={{ fontSize: '12.5px', lineHeight: 1.8, color: C.ink }}>{tip}</p>
                  </li>
                ),
              )}
            </ol>
          </div>

          <div>
            <button
              onClick={saveAsItemPhoto}
              className="w-full py-3.5 text-sm font-semibold"
              style={{ backgroundColor: C.blue, color: '#FFFFFF' }}
            >
              {t.quickAddSaveAsItemCta}
            </button>
            <button
              onClick={retake}
              className="mt-2.5 w-full py-3.5 text-sm font-bold"
              style={{ border: `1px solid ${C.line}`, color: C.ink }}
            >
              {t.quickAddRetakeReceiptCta}
            </button>
            <button
              onClick={keepAsReceipt}
              className="mt-3 w-full text-center font-semibold"
              style={{ fontSize: '11.5px', color: C.blueDeep }}
            >
              {t.quickAddKeepAsReceiptCta}
            </button>
          </div>
        </div>
      </FullScreenSheet>
    );
  }

  return (
    <FullScreenSheet>
      <div
        className="sticky top-0 z-10 flex items-center justify-between kaeru-pad"
        style={{
          backgroundColor: C.page,
          borderBottom: `1px solid ${C.ink}`,
          paddingTop: 'max(16px, env(safe-area-inset-top))',
          paddingBottom: '16px',
        }}
      >
        <button onClick={onClose} style={{ fontSize: '13px', color: C.sub }}>
          {t.cancel}
        </button>
        <h2 className="font-bold" style={{ fontSize: '15px' }}>
          {t.quickAddTitle}
        </h2>
        <button
          onClick={() => onSaveQuick(buildDraft(), imgs)}
          disabled={!canSave}
          className="font-bold disabled:opacity-40"
          style={{ fontSize: '13px', color: C.blueDeep }}
        >
          {t.quickAddSave}
        </button>
      </div>

      <div
        className="kaeru-pad py-6"
        style={{ display: 'flex', flexDirection: 'column', gap: amountFound ? '20px' : '16px' }}
      >
        <div>
          <div
            className="mx-auto"
            style={{
              width: '100%',
              // 沒讀到金額這頁多加了一列稅率按鈕，390×844 塞不下還維持
              // 196px 的預覽——縮小這張，把空間讓給新按鈕，讀到金額的
              // 畫面（46）沒有新增內容，維持原尺寸。
              maxWidth: amountFound ? '196px' : '170px',
              height: amountFound ? '196px' : '170px',
              backgroundColor: C.soft,
              border: `1px solid ${C.line}`,
            }}
          >
            <img src={imgs[0]?.src} alt="" className="h-full w-full object-contain" />
          </div>
          <div className="mt-3 flex flex-wrap justify-center gap-1.5">
            {photoIsItem ? (
              <Badge tone="outline">{t.photoTypeItemLabel}</Badge>
            ) : amountFound ? (
              <Badge tone="sage">{t.quickAddGotAmount}</Badge>
            ) : (
              <Badge tone="clay">{t.quickAddNoAmountBadge}</Badge>
            )}
          </div>
        </div>

        {/* 這裡故意用 amountFound（OCR 本身有沒有讀到），不是
            amountReady（金額+稅率現在有沒有備齊）——amountReady 每打一個
            字元就會重新算一次，用它決定要不要切成摘要卡，會變成打第一
            個數字（只要稅率已經選好）畫面就整個換成摘要卡，輸入框直接
            消失，後面的數字根本打不進去，卡死在一個不完整的金額上。
            OCR 沒讀到金額時，這個畫面要從頭到尾維持手動輸入表單，讓
            使用者能一路打完、改字，不會被自己還沒打完的輸入打斷。
            amountReady 還是有用——CTA 文案、稅率/金額待補標籤要不要
            顯示，這些不影響「輸入框在不在」，繼續用 amountReady 沒問題。 */}
        {amountFound ? (
          <div style={{ backgroundColor: C.soft, padding: '14px' }}>
            <div className="flex items-baseline justify-between gap-3">
              <div className="min-w-0">
                <p style={{ fontSize: '11px', color: C.sub }}>
                  {t.quickAddReadIncl}
                </p>
                <p
                  className="mt-1"
                  style={{ fontSize: '10.5px', color: C.sub, whiteSpace: 'nowrap' }}
                >
                  {t.quickAddRateLine(rateLabel, yen(net), yen(tax))}
                </p>
              </div>
              <p
                className="shrink-0 font-semibold tabular-nums"
                style={{ fontSize: '24px', color: C.ink }}
              >
                ¥{yen(incl)}
              </p>
            </div>
            <div
              style={{
                borderTop: `1px solid ${C.line}`,
                marginTop: '10px',
                paddingTop: '10px',
              }}
            >
              <span
                className="font-semibold"
                style={{ fontSize: '12px', color: metThreshold ? C.sage : C.clayInk }}
              >
                {metThreshold
                  ? t.reached
                  : `${t.notReached} · ${t.short} ¥${yen(5000 - net)}`}
              </span>
            </div>
          </div>
        ) : (
          <div>
            <Field label={t.inclAmount}>
              <div className="flex items-baseline gap-2">
                <input
                  type="text"
                  inputMode="numeric"
                  value={manualIncl}
                  onChange={(e) => setManualIncl(e.target.value.replace(/[^\d]/g, ''))}
                  placeholder={photoIsItem ? t.quickAddInclPlaceholderNoPhoto : t.quickAddInclPlaceholder}
                  className="quick-add-incl-input flex-1 bg-transparent font-semibold tabular-nums outline-none"
                  style={{
                    border: 'none',
                    borderBottom: `1px solid ${C.ink}`,
                    color: C.ink,
                    padding: '0 0 8px',
                    fontSize: '20px',
                  }}
                />
                <span
                  className="shrink-0 font-semibold"
                  style={{ fontSize: '13px', color: C.sub, paddingBottom: '8px' }}
                >
                  ¥
                </span>
              </div>
            </Field>
            <style>{`.quick-add-incl-input::placeholder{color:${C.sub};font-weight:600;font-size:20px}`}</style>

            {(incl <= 0 || !rate) && (
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                {/* 兩個都是線框——線框＝待補，clay 填色＝警示，這裡是
                    「還沒填」不是「填錯了」，不能套警示樣式，那是在
                    考使用者，不是在幫他記帳。 */}
                {incl <= 0 && <Badge tone="outline">{t.pendingAmountBadge}</Badge>}
                {!rate && <Badge tone="outline">{t.quickAddRateRequiredBadge}</Badge>}
              </div>
            )}

            {/* 稅率待選這個標籤原本掛在畫面上卻沒有任何欄位可以選——
                標籤指向一個不存在的東西。稅率是使用者自己知道的（買
                什麼東西幾%），不需要等 OCR，反而是最容易當場點掉的一
                格，補上這一列三顆按鈕。「兩種都有」故意不在這裡展開
                兩格輸入——店裡那五秒鐘不塞第二層輸入，直接標成待補，
                回頭在詳情頁拆。 */}
            <div className="mt-3">
              <p
                className="font-bold"
                style={{ fontSize: '10.5px', color: C.blue, letterSpacing: '0.22em' }}
              >
                {t.taxRate}
              </p>
              <div className="mt-2 flex gap-1.5">
                {[8, 10].map((r) => (
                  <button
                    key={r}
                    onClick={() => setManualRate(r)}
                    className="font-semibold tabular-nums"
                    style={{
                      flex: 1,
                      padding: '10px 0',
                      fontSize: '13px',
                      backgroundColor: manualRate === r ? C.blue : C.soft,
                      color: manualRate === r ? '#FFFFFF' : C.ink,
                      border: `1px solid ${manualRate === r ? C.blue : C.line}`,
                      borderRadius: 0,
                    }}
                  >
                    {r}%
                  </button>
                ))}
                <button
                  onClick={() => setManualRate('mixed')}
                  className="font-semibold"
                  style={{
                    flex: 1.4,
                    padding: '10px 0',
                    fontSize: '13px',
                    backgroundColor: manualRate === 'mixed' ? C.blue : C.soft,
                    color: manualRate === 'mixed' ? '#FFFFFF' : C.ink,
                    border: `1px solid ${manualRate === 'mixed' ? C.blue : C.line}`,
                    borderRadius: 0,
                  }}
                >
                  {t.taxRateBoth}
                </button>
              </div>
              <p className="mt-2" style={{ fontSize: '11.5px', color: C.sub, lineHeight: 1.6 }}>
                {t.quickAddManualRateHint}
              </p>
            </div>

            {/* 這段文案原本假設「這是收據，只是照片模糊沒讀到」——選過
                「存成物品照片」之後，這張已經不是收據了，繼續講「收據
                上的合計」「照片有點模糊」會很矛盾（使用者剛剛才告訴
                app 這根本不是收據，畫面卻還在講「你的收據」）。金額本
                身這裡也不是必填——底下「存起來，金額晚點補」CTA 只要
                退款方式選了就能按，這段文案要講清楚這件事，不然使用者
                會誤以為金額框沒填就存不了。 */}
            <p className="mt-2.5" style={{ fontSize: '11.5px', color: C.sub, lineHeight: 1.7 }}>
              {photoIsItem ? t.quickAddNoAmountDescItemPhoto : t.quickAddNoAmountDesc}
            </p>
          </div>
        )}

        <div>
          <p className="font-bold" style={{ fontSize: '13px', color: C.ink }}>
            {t.refundQ}
          </p>
          <div className="mt-2.5 flex gap-1.5">
            {[
              ['registered', t.refundOptRegistered],
              ['no', t.refundOptNo],
              ['unsure', t.refundOptUnsure],
            ].map(([v, label]) => (
              <button
                key={v}
                onClick={() => setRefundMethod(v)}
                className="font-semibold"
                style={{
                  flex: 1,
                  padding: '10px 0',
                  fontSize: '13px',
                  backgroundColor: refundMethod === v ? C.blue : C.soft,
                  color: refundMethod === v ? '#FFFFFF' : C.ink,
                  border: `1px solid ${refundMethod === v ? C.blue : C.line}`,
                  borderRadius: 0,
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <p className="mt-2" style={{ fontSize: '11.5px', color: C.sub, lineHeight: 1.7 }}>
            {t.refundHint}
          </p>
        </div>

        {!parsed?.shop && (
          <div className="flex items-center justify-between gap-3">
            <div>
              <p style={{ fontSize: '13px', color: C.ink }}>{t.pendingFieldsLabel}</p>
              <p className="mt-0.5" style={{ fontSize: '11.5px', color: C.sub }}>
                {t.pendingFieldsDesc}
              </p>
            </div>
            <Badge tone="outline">{t.pendingFieldBadge}</Badge>
          </div>
        )}

        <div>
          {/* 金額待補不再停用主 CTA——擋住不如誠實，這個 App 是幫使用者
              記帳的，不是在考他。金額還沒填也能先存，只是進去以後這張
              收據會用「待補」樣式顯示、不計入預估可退稅額，直到補上為
              止。唯一還會讓這顆按鈕變灰的是退款方式沒選，或金額已經
              填了一半、稅率還沒選（見 canSave）。 */}
          <button
            onClick={() => onSaveQuick(buildDraft(), imgs)}
            disabled={!canSave}
            className="w-full py-3.5 text-sm font-semibold disabled:opacity-40"
            style={{ backgroundColor: C.blue, color: '#FFFFFF' }}
          >
            {amountReady ? t.quickSaveCta : t.quickSaveCtaAmountPending}
          </button>
          {!amountReady && (
            <p className="mt-2 text-center" style={{ fontSize: '11px', color: C.sub }}>
              {t.quickSaveCtaAmountPendingHint}
            </p>
          )}
          {amountReady ? (
            <button
              onClick={() => onSaveFull(buildDraft(), imgs)}
              className="mt-3 w-full text-center font-semibold"
              style={{ fontSize: '13px', color: C.blueDeep }}
            >
              {t.quickFullFormCta}
            </button>
          ) : (
            // 讀不到金額時，比起跳去填完整表單，重拍一張清楚的照片更
            // 可能直接解決問題，所以次要動作換成這個，不是原本的連結。
            <button
              onClick={retake}
              className="mt-3 w-full text-center font-semibold"
              style={{ fontSize: '13px', color: C.blueDeep }}
            >
              {t.retakePhotoCta}
            </button>
          )}
        </div>
      </div>
    </FullScreenSheet>
  );
}

function EditSheet({
  t,
  initial,
  photos,
  onClose,
  onSave,
  photoPermissionPrimed,
  onPhotoPermissionPrimed,
}) {
  const [shop, setShop] = useState(initial?.shop || '');
  const [date, setDate] = useState(initial?.date || todayStr());
  const [incl, setIncl] = useState(initial?.incl ?? '');
  const [incl8, setIncl8] = useState(initial?.incl8 ?? '');
  const [incl10, setIncl10] = useState(initial?.incl10 ?? '');
  const [rate, setRate] = useState(initial?.rate ?? 10);
  const [taxOverride, setTaxOverride] = useState(
    initial?.taxOverride === null || initial?.taxOverride === undefined
      ? ''
      : initial.taxOverride,
  );
  // 三選一：有登記／沒有／不確定。舊資料用 inferRefundMethod() 從
  // status 反推（見該函式註解，只有停在「已登記」那一站才是可靠訊號）。
  const [refundMethod, setRefundMethod] = useState(inferRefundMethod(initial));
  const refundReg = refundMethod === 'registered';
  const [unpacked, setUnpacked] = useState(initial?.unpacked || false);
  const [consumed, setConsumed] = useState(initial?.consumed || false);
  const [note, setNote] = useState(initial?.note || '');
  const [imgs, setImgs] = useState(photos || []);

  // 返回時判斷「有沒有還沒存的變動」：跟掛載當下那份初始值比對，
  // 差一個字都算有改。新增收據（initial 沒傳）從全部預設值開始比。
  const initialSnapshotRef = useRef(
    JSON.stringify({
      shop: initial?.shop || '',
      date: initial?.date || todayStr(),
      incl: initial?.incl ?? '',
      incl8: initial?.incl8 ?? '',
      incl10: initial?.incl10 ?? '',
      rate: initial?.rate ?? 10,
      taxOverride:
        initial?.taxOverride === null || initial?.taxOverride === undefined
          ? ''
          : initial.taxOverride,
      refundMethod: inferRefundMethod(initial),
      unpacked: initial?.unpacked || false,
      consumed: initial?.consumed || false,
      note: initial?.note || '',
      imgs: photos || [],
    }),
  );
  const isDirty =
    JSON.stringify({
      shop,
      date,
      incl,
      incl8,
      incl10,
      rate,
      taxOverride,
      refundMethod,
      unpacked,
      consumed,
      note,
      imgs,
    }) !== initialSnapshotRef.current;
  const guard = useDirtyBackGuard(isDirty, onClose);
  const [lightboxIndex, setLightboxIndex] = useState(null);
  useBackClose(lightboxIndex !== null, () => setLightboxIndex(null));

  const mixed = rate === 'mixed';
  const v8 = Number(incl8) || 0;
  const v10 = Number(incl10) || 0;
  const incl8Filled = incl8 !== '' && incl8 !== null;
  const incl10Filled = incl10 !== '' && incl10 !== null;
  const net8 = netOf(v8, 8);
  const net10 = netOf(v10, 10);
  const tax8 = v8 - net8;
  const tax10 = v10 - net10;
  const singleNet = netOf(Number(incl) || 0, mixed ? 10 : rate);
  const singleAutoTax = (Number(incl) || 0) - singleNet;
  const net = mixed ? net8 + net10 : singleNet;
  const autoTax = mixed ? tax8 + tax10 : singleAutoTax;
  const effectiveIncl = mixed ? v8 + v10 : Number(incl) || 0;
  const bothFilled = incl8Filled && incl10Filled;
  const showPartialWarn = mixed && incl8Filled !== incl10Filled;
  // 稅抜合計對 5,000 円門檻的即時判定：達標用 sage，未達用 clay + 還差多少
  const metThreshold = net >= 5000;
  const thresholdText = metThreshold
    ? t.reached
    : `${t.notReached} · ${t.short} ¥${yen(5000 - net)}`;
  const thresholdColor = metThreshold ? C.sage : C.clay;

  function pickRate(r) {
    if (r !== 'mixed' && mixed) {
      // 從混合切回單一：兩格加總帶回含稅金額，兩格本身不清空
      setIncl(v8 + v10 ? String(v8 + v10) : '');
    }
    setRate(r);
  }

  const cap = usePhotoCapture({
    imgs,
    setImgs,
    onParsed: (parsed) => {
      // usePhotoCapture 現在不管有沒有讀到東西都會呼叫這個 callback
      // （讀不到也要讓呼叫端知道），完整表單不需要「不像收據」那個
      // 分支，讀不到就什麼都不做，維持原本已經填的內容。
      if (!parsed) return;
      if (parsed.shop && !shop.trim()) setShop(parsed.shop);
      if (parsed.date) setDate(parsed.date);
      if (parsed.rate === 'mixed') {
        setRate('mixed');
        if (parsed.incl8 != null) setIncl8(String(parsed.incl8));
        if (parsed.incl10 != null) setIncl10(String(parsed.incl10));
      } else if (parsed.rate != null) {
        setRate(parsed.rate);
        setIncl(String(parsed.incl));
      }
    },
    permissionPrimed: photoPermissionPrimed,
    onPrimed: onPhotoPermissionPrimed,
  });

  function save() {
    const id =
      initial?.id ||
      `r_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    let status = initial?.status || 'purchased';
    if (refundReg && STAGES.indexOf(status) < 1) status = 'registered';
    // 這裡故意只在 status 剛好停在「已登記」(=== 1) 才退回「已購買」，
    // 不是 <= 1——如果 status 已經推進到「已查驗」或「已退款」，那是
    // 真實世界發生過的事（機場真的查驗過、錢真的進來過），不能因為
    // 使用者事後把退款方式改成「沒有/不確定」就往回洗掉，跟下面
    // consumed 那條「只把已查驗退回已登記」是同一個原則：退款方式這
    // 個欄位跟查驗/退款是兩件事，反悔前者不代表後者沒發生過。
    if (!refundReg && STAGES.indexOf(status) === 1) status = 'purchased';
    // 只把「已查驗」退回「已登記」——已經退款是既成事實，事後補記
    // 「這張也在境內用掉了」不該把已經拿到手的退款記錄洗掉。
    if (consumed && status === 'verified') status = 'registered';

    let finalRate = rate;
    let finalIncl = effectiveIncl;
    if (mixed && !bothFilled) {
      // 只填一格：儲存時自動降回該單一稅率模式
      if (incl8Filled) {
        finalRate = 8;
        finalIncl = v8;
      } else if (incl10Filled) {
        finalRate = 10;
        finalIncl = v10;
      }
    }

    onSave(
      {
        id,
        shop: shop.trim(),
        date,
        incl: finalIncl,
        rate: finalRate,
        incl8: incl8Filled ? v8 : null,
        incl10: incl10Filled ? v10 : null,
        taxOverride: taxOverride === '' ? null : Number(taxOverride),
        refundMethod,
        unpacked,
        consumed,
        note: note.trim(),
        status,
        hasPhoto: !!imgs.length,
        tripId: initial?.tripId,
      },
      imgs,
    );
  }

  return (
    <>
    <FullScreenSheet>
      <div
        className="sticky top-0 z-10 flex items-center justify-between kaeru-pad"
        style={{
          backgroundColor: C.page,
          borderBottom: `1px solid ${C.ink}`,
          paddingTop: 'max(16px, env(safe-area-inset-top))',
          paddingBottom: '16px',
        }}
      >
        <button onClick={guard.requestClose} style={{ fontSize: '15px', color: C.sub }}>
          {t.cancel}
        </button>
        <h2 className="font-bold" style={{ fontSize: '15px' }}>
          {initial ? t.edit : t.addReceipt}
        </h2>
        <button
          onClick={save}
          // 必填只有金額（跟稅率，但稅率一定有值，見上面 rate 的
          // useState 預設）——店名跟日期一樣可以待補，完整表單不該比
          // 快路更嚴格。少了這個欄位就存不了收據，見
          // CLAUDE_CODE_DELTA_照片型別.md 第 1 節。
          disabled={!effectiveIncl}
          className="font-bold disabled:opacity-40"
          style={{ fontSize: '13px', color: C.blueDeep }}
        >
          {t.save}
        </button>
      </div>

      <div
        className="kaeru-pad py-6"
        style={{ display: 'flex', flexDirection: 'column', gap: '26px' }}
      >
        <Field label={t.shop}>
          <Input value={shop} onChange={(e) => setShop(e.target.value)} />
        </Field>

        <Field label={t.date}>
          <DateField
            value={date}
            onChange={(v) => setDate(v || todayStr())}
            t={t}
          />
        </Field>

        <Field label={t.taxRate}>
          <div className="flex gap-1.5">
            {[8, 10].map((r) => (
              <button
                key={r}
                onClick={() => pickRate(r)}
                className="font-semibold"
                style={{
                  flex: 1,
                  padding: '10px 0',
                  fontSize: '13px',
                  backgroundColor: rate === r ? C.blue : C.soft,
                  color: rate === r ? '#FFFFFF' : C.ink,
                  border: `1px solid ${rate === r ? C.blue : C.line}`,
                  borderRadius: 0,
                }}
              >
                {r}%
              </button>
            ))}
            <button
              onClick={() => pickRate('mixed')}
              className="font-semibold"
              style={{
                flex: 1.5,
                padding: '10px 0',
                fontSize: '13px',
                backgroundColor: mixed ? C.blue : C.soft,
                color: mixed ? '#FFFFFF' : C.ink,
                border: `1px solid ${mixed ? C.blue : C.line}`,
                borderRadius: 0,
              }}
            >
              {t.taxRateBoth}
            </button>
          </div>
        </Field>
        <p
          className="-mt-3"
          style={{ color: C.sub, fontSize: '11.5px', lineHeight: 1.75 }}
        >
          {t.rateHint}
        </p>

        {!mixed && (
          <Field label={t.inclAmount}>
            <input
              type="text"
              inputMode="numeric"
              value={incl === '' ? '' : `¥${yen(incl)}`}
              onChange={(e) => setIncl(e.target.value.replace(/[^\d]/g, ''))}
              className="jp-underline w-full bg-transparent font-semibold tabular-nums outline-none"
              style={{
                border: 'none',
                borderBottom: `1px solid ${C.line}`,
                color: C.ink,
                padding: '0 0 10px',
                fontSize: '20px',
              }}
            />
          </Field>
        )}

        {mixed && (
          <div
            style={{
              borderTop: `1px solid ${C.line}`,
              paddingTop: '15px',
              display: 'flex',
              flexDirection: 'column',
              gap: '15px',
            }}
          >
            {[
              {
                label: t.tax8Label,
                sub: t.tax8Sub,
                value: incl8,
                set: setIncl8,
              },
              {
                label: t.tax10Label,
                sub: t.tax10Sub,
                value: incl10,
                set: setIncl10,
              },
            ].map((row) => (
              <div
                key={row.label}
                className="flex items-end justify-between gap-3"
              >
                <span className="shrink-0">
                  <span
                    className="block font-bold"
                    style={{ fontSize: '12.5px', color: C.ink }}
                  >
                    {row.label}
                  </span>
                  <span
                    className="mt-0.5 block"
                    style={{ fontSize: '10.5px', color: C.sub }}
                  >
                    {row.sub}
                  </span>
                </span>
                <input
                  type="text"
                  inputMode="numeric"
                  placeholder={t.inclAmount}
                  value={row.value === '' ? '' : `¥${yen(row.value)}`}
                  onChange={(e) => row.set(e.target.value.replace(/[^\d]/g, ''))}
                  className="jp-underline bg-transparent text-right font-semibold tabular-nums outline-none"
                  style={{
                    flex: 1,
                    maxWidth: '168px',
                    border: 'none',
                    borderBottom: `1px solid ${C.line}`,
                    color: C.ink,
                    fontSize: '19px',
                    padding: '0 0 8px',
                  }}
                />
              </div>
            ))}
          </div>
        )}

        {!mixed ? (
          <div style={{ backgroundColor: C.soft, padding: '13px 14px' }}>
            <div className="flex items-baseline justify-between gap-3">
              <div className="min-w-0">
                <p style={{ fontSize: '11px', color: C.sub }}>
                  {t.taxAmount}（{t.taxAuto}）
                </p>
                <p
                  className="mt-1 tabular-nums"
                  style={{ fontSize: '10.5px', color: C.sub, whiteSpace: 'nowrap' }}
                >
                  {t.netTotal} ¥{yen(net)}
                  <span
                    style={{
                      marginLeft: '7px',
                      fontWeight: 600,
                      color: thresholdColor,
                    }}
                  >
                    {thresholdText}
                  </span>
                </p>
              </div>
              <input
                type="text"
                inputMode="numeric"
                placeholder={`¥${yen(autoTax)}`}
                value={taxOverride === '' ? '' : `¥${yen(taxOverride)}`}
                onChange={(e) =>
                  // 打字時就把值夾在 [0, autoTax]——理論退稅上限，不等
                  // 使用者存檔後才發現多打一個 0 被吃進總額裡。
                  setTaxOverride(() => {
                    const digits = e.target.value.replace(/[^\d]/g, '');
                    if (digits === '') return '';
                    return String(Math.min(Number(digits), autoTax));
                  })
                }
                className="bg-transparent text-right font-semibold tabular-nums outline-none"
                style={{
                  border: 'none',
                  color: C.blueDeep,
                  fontSize: '22px',
                  width: '45%',
                }}
              />
            </div>
          </div>
        ) : (
          <div style={{ backgroundColor: C.soft, padding: '14px' }}>
            <div className="flex items-baseline justify-between gap-3">
              <span style={{ fontSize: '11px', color: C.sub }}>
                {t.inclTotalLabel}　{t.autoFilledHint}
              </span>
              <span
                className="font-semibold tabular-nums"
                style={{ fontSize: '20px', color: bothFilled ? C.ink : C.sub }}
              >
                ¥{yen(effectiveIncl)}
              </span>
            </div>

            <div
              style={{
                borderTop: `1px solid ${C.line}`,
                marginTop: '10px',
                paddingTop: '10px',
              }}
            >
              <div
                className="flex items-baseline justify-between tabular-nums"
                style={{ fontSize: '11.5px', color: C.sub }}
              >
                <span>
                  {incl8Filled
                    ? `${t.tax8Label} ${t.netBare} ¥${yen(net8)}`
                    : t.tax8Label}
                </span>
                <span>
                  {incl8Filled ? `${t.taxAmount} ¥${yen(tax8)}` : t.notFilled}
                </span>
              </div>
              <div
                className="mt-1.5 flex items-baseline justify-between tabular-nums"
                style={{ fontSize: '11.5px', color: C.sub }}
              >
                <span>
                  {incl10Filled
                    ? `${t.tax10Label} ${t.netBare} ¥${yen(net10)}`
                    : t.tax10Label}
                </span>
                <span>
                  {incl10Filled ? `${t.taxAmount} ¥${yen(tax10)}` : t.notFilled}
                </span>
              </div>
            </div>

            {bothFilled && (
              <div
                style={{
                  borderTop: `1px solid ${C.line}`,
                  marginTop: '10px',
                  paddingTop: '10px',
                }}
              >
                <div className="flex items-baseline justify-between gap-3">
                  <div className="min-w-0">
                    <p style={{ fontSize: '11px', color: C.sub }}>
                      {t.taxTotalAuto}
                    </p>
                    <p
                      className="mt-1 tabular-nums"
                      style={{ fontSize: '10.5px', color: C.sub, whiteSpace: 'nowrap' }}
                    >
                      {t.netTotal} ¥{yen(net)}
                      <span
                        style={{
                          marginLeft: '7px',
                          fontWeight: 600,
                          color: thresholdColor,
                        }}
                      >
                        {thresholdText}
                      </span>
                    </p>
                  </div>
                  <input
                    type="text"
                    inputMode="numeric"
                    placeholder={`¥${yen(autoTax)}`}
                    value={taxOverride === '' ? '' : `¥${yen(taxOverride)}`}
                    onChange={(e) =>
                      setTaxOverride(e.target.value.replace(/[^\d]/g, ''))
                    }
                    className="bg-transparent text-right font-semibold tabular-nums outline-none"
                    style={{
                      border: 'none',
                      color: C.blueDeep,
                      fontSize: '22px',
                      width: '45%',
                    }}
                  />
                </div>
              </div>
            )}

            {showPartialWarn && (
              <div className="mt-3">
                <Badge tone="clay">
                  {incl8Filled ? t.tax10Label : t.tax8Label}
                  {t.notFilled}
                </Badge>
                <p
                  className="mt-2"
                  style={{ fontSize: '11.5px', color: C.sub, lineHeight: 1.75 }}
                >
                  {t.taxMixedPartialHint}
                </p>
              </div>
            )}
          </div>
        )}

        {net >= 1000000 && <Notice tone="blue">{t.warnHigh}</Notice>}

        <Field label={t.refundReg}>
          <div className="flex gap-1.5">
            {[
              ['registered', t.refundOptRegistered],
              ['no', t.refundOptNo],
              ['unsure', t.refundOptUnsure],
            ].map(([v, label]) => (
              <button
                key={v}
                onClick={() => setRefundMethod(v)}
                className="font-semibold"
                style={{
                  flex: 1,
                  padding: '10px 0',
                  fontSize: '13px',
                  backgroundColor: refundMethod === v ? C.blue : C.soft,
                  color: refundMethod === v ? '#FFFFFF' : C.ink,
                  border: `1px solid ${refundMethod === v ? C.blue : C.line}`,
                  borderRadius: 0,
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <p className="mt-2" style={{ fontSize: '11.5px', color: C.sub, lineHeight: 1.7 }}>
            {t.refundHint}
          </p>
        </Field>
        <Toggle
          checked={unpacked}
          onChange={setUnpacked}
          label={t.unpacked}
          hint={t.unpackedHint}
        />
        <Toggle
          checked={consumed}
          onChange={setConsumed}
          label={t.consumed}
          hint={t.consumedHint}
          warn
        />

        {consumed && (
          <p
            style={{
              backgroundColor: C.soft,
              borderLeft: `3px solid ${C.clay}`,
              color: C.clayInk,
              fontSize: '12.5px',
              lineHeight: 1.7,
              padding: '12px 14px',
            }}
          >
            {t.warnConsumed}
          </p>
        )}

        <PhotoAttachments
          t={t}
          photos={imgs}
          cap={cap}
          onOpenLightbox={setLightboxIndex}
        />

        <Field label={t.note}>
          <Input value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
    </FullScreenSheet>

    <PhotoCaptureSheets t={t} cap={cap} />

    {lightboxIndex !== null && (
      <PhotoLightbox
        t={t}
        shop={shop}
        date={date}
        photos={imgs}
        index={lightboxIndex}
        onIndexChange={setLightboxIndex}
        onClose={() => setLightboxIndex(null)}
        onDeletePhoto={(i) => {
          const willBeEmpty = imgs.length <= 1;
          cap.removeImg(i);
          if (willBeEmpty) setLightboxIndex(null);
          else setLightboxIndex((idx) => Math.min(idx, imgs.length - 2));
        }}
        onRotatePhoto={async (i) => {
          try {
            const rotated = await rotateImageSrc(imgs[i].src, 90);
            setImgs((prev) => prev.map((p, pi) => (pi === i ? { ...p, src: rotated } : p)));
          } catch (e) {}
        }}
      />
    )}

    {guard.discardOpen && (
      <DiscardConfirmSheet
        t={t}
        onKeepEditing={guard.keepEditing}
        onDiscard={guard.discard}
      />
    )}
    </>
  );
}

// 畫面4：確認與裁切。四角把手是相對於「圖片自己實際渲染出來的那個框」
// 的百分比座標（0~1），拖曳時用 wrapperRef 量測出來的框反推百分比，
// 這樣不管圖片比例、螢幕大小都對得上，不用管 object-fit 的letterbox。
function PhotoConfirmSheet({ t, src, fromScan, onRetake, onUse, onClose }) {
  const DEFAULT_CORNERS = [
    { x: 0.04, y: 0.04 },
    { x: 0.96, y: 0.04 },
    { x: 0.96, y: 0.96 },
    { x: 0.04, y: 0.96 },
  ];
  const [corners, setCorners] = useState(DEFAULT_CORNERS);
  const [rotation, setRotation] = useState(0);
  const [contrastOn, setContrastOn] = useState(false);
  const [outBytes, setOutBytes] = useState(null);
  const [ocr, setOcr] = useState({ loading: true, parsed: null, looksLikeReceipt: true });
  const [inBytes, setInBytes] = useState(0);
  const wrapperRef = useRef(null);
  const imgRef = useRef(null);
  const dragIdx = useRef(null);

  // src 可能是 data URL（掃描結果，原生端已經是 base64）或是相機給的
  // webPath（檔案路徑，不是 base64）——「壓縮前」大小要看情況：是
  // data URL 就直接算，是路徑就實際抓一次檔案大小。
  useEffect(() => {
    let alive = true;
    if (src.startsWith('data:')) {
      setInBytes(dataUrlBytes(src));
    } else {
      fetch(src)
        .then((r) => r.blob())
        .then((b) => alive && setInBytes(b.size))
        .catch(() => alive && setInBytes(0));
    }
    return () => {
      alive = false;
    };
  }, [src]);

  // 返回時的「有沒有改過」：裁切把手、旋轉、對比隨便動一個就算——
  // 使用者已經花時間調過，返回不能默默丟掉。
  const isDirty =
    rotation !== 0 ||
    contrastOn ||
    JSON.stringify(corners) !== JSON.stringify(DEFAULT_CORNERS);
  const guard = useDirtyBackGuard(isDirty, onClose);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        // recognizeText 原生端只吃 base64；掃描結果本來就是 data URL，
        // 相機給的 webPath 不是，要先轉一次。這一步跟畫面顯示無關，
        // 不會擋到裁切畫面出現，使用者已經看得到照片、可以開始調整了。
        const b64Src = src.startsWith('data:') ? src : await compressImageSrc(src, 1600, 0.85);
        const res = await ReceiptScanner.recognizeText({ image: b64Src });
        if (!alive) return;
        // 有座標（lines）就用它重組出跟收據實際排版一致的閱讀順序，
        // 原生端直接接好的 text 常常是「左欄全部先列完，右欄才接著
        // 列」，標籤跟金額對不起來；沒有座標（例如原生端還沒更新過）
        // 才退回用 text。
        const reconstructed = res?.lines?.length
          ? reconstructRowsFromLines(res.lines)
          : '';
        const forParse = reconstructed || res?.text || '';
        // 方便真機除錯：原始文字、重組後文字、解析結果都印出來——
        // 「讀不到」跟「辨識本身失敗」在畫面上長一樣，但 console 看得出差別，
        // 重組後文字如果還是抓不到，代表要調的是 parseReceiptOCR 的規則，
        // 不是座標重組本身。
        console.log('[ReceiptScanner] recognized text (raw):', res?.text);
        console.log(
          '[ReceiptScanner] recognized text (reconstructed by position):',
          reconstructed,
        );
        const parsed = parseReceiptOCR(forParse);
        const looksLikeReceipt = looksLikeReceiptText(forParse);
        console.log('[ReceiptScanner] parsed:', parsed);
        console.log('[ReceiptScanner] looks like receipt:', looksLikeReceipt);
        setOcr({ loading: false, parsed, looksLikeReceipt });
      } catch (err) {
        console.error('[ReceiptScanner] recognizeText failed:', err);
        // 辨識這一步本身失敗（權限、原生端出錯）跟「拍到的東西真的不
        // 像收據」是不一樣的兩件事，這裡沒有任何文字可以判斷，不能
        // 直接當作「不像收據」——那樣使用者什麼都沒做錯，卻被問一句
        // 「這是不是收據」，莫名其妙。looksLikeReceipt 給 true，讓它
        // 照舊走「讀不到，手動補」那條路。
        if (alive) setOcr({ loading: false, parsed: null, looksLikeReceipt: true });
      }
    })();
    return () => {
      alive = false;
    };
  }, [src]);

  function buildOutput() {
    const img = imgRef.current;
    // 圖片還沒真的載入完成（naturalWidth/Height 是 0）就硬算，四個角點會
    // 全部變成 (0,0)，裁切算出來的寬高會被 Math.max(1, ...) 夾成 1×1，
    // 不會拋錯，卻會存出一張看起來正常存檔成功、實際上是空白的垂圾
    // 照片。這裡先擋掉，讓下面呼叫端的 catch 退回用原圖，不要讓這種
    // 半成品悄悄存進收據裡。
    if (!img || !img.naturalWidth || !img.naturalHeight) {
      throw new Error('image not ready');
    }
    const natCorners = corners.map((f) => ({
      x: f.x * img.naturalWidth,
      y: f.y * img.naturalHeight,
    }));
    const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
    const [TL, TR, BR, BL] = natCorners;
    let w = Math.round((dist(TL, TR) + dist(BL, BR)) / 2);
    let h = Math.round((dist(TL, BL) + dist(TR, BR)) / 2);
    // 四個裁切把手各自獨立拖曳、沒有互相檔位限制，使用者可能把它們拖成
    // 幾乎共線或交叉的畸形四邊形——這種情況下 w/h 會逼近 0，裁切結果是
    // 一張看不出內容的黑色/透明小圖，一樣不拋錯。20px 是任何真的收據
    // 照片不可能小到的門檻，低於這個數字直接當作裁切失敗，退回用原圖，
    // 好過存一張看不出東西的照片。
    if (w < 20 || h < 20) {
      throw new Error('crop area too small');
    }
    const scale = Math.min(1, 1000 / Math.max(w, h, 1));
    w = Math.max(1, Math.round(w * scale));
    h = Math.max(1, Math.round(h * scale));
    let canvas = perspectiveCrop(img, natCorners, w, h);
    canvas = rotateCanvas(canvas, rotation);
    if (contrastOn) applyContrast(canvas);
    return canvas.toDataURL('image/jpeg', 0.7);
  }

  // 邊框／旋轉／對比隨手拖動時debounce 重算一次輸出大小，給「1.2 MB → 240 KB」用
  useEffect(() => {
    const h = setTimeout(() => {
      if (!imgRef.current || !imgRef.current.naturalWidth) return;
      try {
        setOutBytes(dataUrlBytes(buildOutput()));
      } catch (e) {}
    }, 250);
    return () => clearTimeout(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [corners, rotation, contrastOn]);

  function ptToFraction(clientX, clientY) {
    const r = wrapperRef.current.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    const y = Math.min(1, Math.max(0, (clientY - r.top) / r.height));
    return { x, y };
  }

  // 這裡原本 onPointerDown／onTouchStart 兩個都綁同一個 handler，外加
  // window 上 pointermove/touchmove、pointerup/touchend 兩套都掛——手機
  // 上一次觸控會同時送出 pointer 跟 touch 兩種事件，等於整段邏輯跑兩
  // 次（其實無害，只是浪費），但 React 對 touchstart 這個合成事件預設
  // 是 passive，裡面呼叫 e.preventDefault() 永遠不會真的生效，還會在
  // console 噴「Unable to preventDefault inside passive event listener
  // invocation」這個警告，兩次觸控就噴兩次。這個 app 目標的 WebView
  // （Android Chrome、iOS WKWebView）Pointer Events 都支援得很完整，
  // 別的地方（放大檢視的縮放/滑動、長按改型別）也都只靠 Pointer
  // Events，這裡改成只留 pointer 那一套，touch 那套整個拿掉——功能不受
  // 影響，順便把這個一直存在、一直被忽略的警告清掉。
  function onHandleDown(i) {
    return (e) => {
      e.preventDefault();
      dragIdx.current = i;
      const move = (ev) => {
        if (dragIdx.current === null) return;
        const f = ptToFraction(ev.clientX, ev.clientY);
        setCorners((prev) => {
          const next = [...prev];
          next[dragIdx.current] = f;
          return next;
        });
      };
      const up = () => {
        dragIdx.current = null;
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    };
  }

  // ocr.parsed 不是 null 不代表「讀到金額了」——parseReceiptOCR 只要
  // 抓到店名或日期其中一個就會回傳非 null 的物件（見該函式註解），店名
  // 判斷本身又很鬆，隨便什麼包裝上的文字都可能被當成店名。下面「使用
  // 這張並帶入金額」的按鈕文案跟金額預覽，如果只看 ocr.parsed 有沒有
  // 值，會在只抓到店名、完全沒抓到金額的情況下（實測：拍一包咖啡豆，
  // parsed:{shop:'DECAF'}，沒有 incl）還是顯示「帶入金額」、金額預覽
  // 印出 ¥0——跟這次很早就修過的「¥0 謊言」是同一種錯法，只是這裡漏
  // 改到。要看真的有沒有金額，得檢查 incl／incl8／incl10 本身。
  const ocrHasAmount = !!(
    ocr.parsed &&
    (ocr.parsed.incl || ocr.parsed.incl8 || ocr.parsed.incl10)
  );

  // 這裡拿的 ocr.parsed／ocr.looksLikeReceipt 一定要是 OCR 真的跑完之後
  // 的結果——OCR 還沒回來時 ocr 是初始值 {parsed:null,
  // looksLikeReceipt:true}，這個 true 是故意的預設（辨識本身失敗時要
  // 當作「沒判斷」，見下面那個 effect 的註解），但如果使用者手比較快、
  // 在 OCR 還沒跑完就按了「使用照片」，會把這個「還沒判斷」的預設值當
  // 成「看起來像收據」的真結果送出去，讓一張完全不是收據的照片因為
  // OCR 還沒跑完，就被誤判成「像收據」，掉進金額待補畫面，不是「不像
  // 收據」畫面——這不是分類規則錯，是規則根本沒跑到就被拿去用了。兩顆
  // 「使用照片」按鈕都要在 ocr.loading 時停用，擋掉這個時間差。
  function handleUse() {
    if (ocr.loading) return;
    let finalSrc = src;
    try {
      finalSrc = buildOutput();
    } catch (e) {}
    onUse(finalSrc, ocr.parsed, ocr.looksLikeReceipt);
  }

  const toolBtnStyle = (active) => ({
    flex: 1,
    padding: '11px 0',
    minHeight: '44px',
    fontSize: '12.5px',
    border: `1px solid ${active ? C.blue : C.line}`,
    color: active ? C.blueDeep : C.sub,
    fontWeight: active ? 700 : 400,
  });

  return (
    <>
    <FullScreenSheet>
      <div
        className="sticky top-0 z-10 flex items-center justify-between kaeru-pad"
        style={{
          backgroundColor: C.page,
          borderBottom: `1px solid ${C.ink}`,
          paddingTop: 'max(16px, env(safe-area-inset-top))',
          paddingBottom: '16px',
        }}
      >
        <button onClick={onRetake} style={{ fontSize: '13px', color: C.sub }}>
          {t.retakePhoto}
        </button>
        <h2 className="font-bold" style={{ fontSize: '15px' }}>
          {t.confirmPhoto}
        </h2>
        <button
          onClick={handleUse}
          disabled={ocr.loading}
          className="font-bold disabled:opacity-40"
          style={{ fontSize: '13px', color: C.blueDeep }}
        >
          {t.usePhoto}
        </button>
      </div>

      <div className="kaeru-pad py-6">
        <p className="mb-3" style={{ color: C.sub, fontSize: '12px', lineHeight: 1.6 }}>
          {t.frameReminder}
        </p>
        <div
          className="flex items-center justify-center"
          style={{
            height: '392px',
            backgroundColor: C.soft,
            border: `1px solid ${C.line}`,
          }}
        >
          <div ref={wrapperRef} className="relative inline-block" style={{ height: '100%' }}>
            <img
              ref={imgRef}
              src={src}
              alt=""
              className="block"
              style={{ height: '100%', width: 'auto' }}
            />
            {/* polygon 的 points 屬性只吃數字，不吃百分比字串——
                「4%,4% ...」這種寫法在真機瀏覽器上會直接被判定成無效
                值，整個 polygon 悄悄不畫出來（拖曳角點還是能動，只是
                裁切範圍的半透明藍色四邊形完全看不到，使用者拖角點時
                少了最直接的視覺回饋）。用 viewBox 開一個 0~100 的座標
                系統，points 給實際數字（0~100，剛好對應 corners 本來
                就是 0~1 的比例），polygon 才會真的畫出來；
                preserveAspectRatio="none" 是必須的，否則長寬比不是
                1:1 的照片，viewBox 會保留長寬比、不會貼齊整個容器，跟
                角點把手（純 CSS % top/left，本來就貼齊整個容器）對不
                起來。vectorEffect 讓邊框粗細不會因為 viewBox 縮放而
                跟著變粗變細。 */}
            <svg
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
              className="pointer-events-none absolute inset-0 h-full w-full"
              style={{ position: 'absolute', top: 0, left: 0 }}
            >
              <polygon
                points={corners.map((c) => `${c.x * 100},${c.y * 100}`).join(' ')}
                fill="rgba(119,137,154,0.12)"
                stroke={C.blue}
                strokeWidth="1.5"
                vectorEffect="non-scaling-stroke"
              />
            </svg>
            {corners.map((c, i) => (
              <div
                key={i}
                onPointerDown={onHandleDown(i)}
                className="absolute flex items-center justify-center"
                style={{
                  left: `${c.x * 100}%`,
                  top: `${c.y * 100}%`,
                  // 觸控熱區比視覺上的角括號大一圈，方便手指拖曳
                  width: '36px',
                  height: '36px',
                  marginLeft: '-18px',
                  marginTop: '-18px',
                  touchAction: 'none',
                  cursor: 'grab',
                }}
              >
                {/* L 形角括號，跟 29/31 兩張設計稿的記號一致；四個角用同一個
                    「左上」路徑，其他三個角靠 scaleX/scaleY 翻轉出來 */}
                <svg
                  width="24"
                  height="24"
                  viewBox="0 0 24 24"
                  style={{
                    transform: [
                      'none',
                      'scaleX(-1)',
                      'scale(-1,-1)',
                      'scaleY(-1)',
                    ][i],
                  }}
                >
                  <path
                    d="M2 12 L2 2 L12 2"
                    fill="none"
                    stroke={C.blue}
                    strokeWidth="2.5"
                    strokeLinecap="square"
                  />
                </svg>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-1.5">
          {fromScan && <Badge tone="sage">{t.edgeAutoOk}</Badge>}
          {outBytes !== null && (
            <Badge tone="outline">
              {formatBytes(inBytes)} → {formatBytes(outBytes)}
            </Badge>
          )}
        </div>

        <div className="mt-4 flex gap-2">
          <button style={toolBtnStyle(true)}>{t.toolAdjustBorder}</button>
          <button
            style={toolBtnStyle(false)}
            onClick={() => setRotation((r) => (r + 90) % 360)}
          >
            {t.toolRotate}
          </button>
          <button
            style={toolBtnStyle(contrastOn)}
            onClick={() => setContrastOn((v) => !v)}
          >
            {t.toolContrast}
          </button>
        </div>

        {!ocr.loading && ocrHasAmount && (
          <div
            className="mt-4 flex items-end justify-between"
            style={{ backgroundColor: C.soft, padding: '14px' }}
          >
            <div>
              <p style={{ fontSize: '11px', color: C.sub }}>{t.ocrAmountLabel}</p>
              <p className="mt-1" style={{ fontSize: '10.5px', color: C.sub }}>
                {t.ocrHint}
              </p>
            </div>
            <p
              className="font-semibold tabular-nums"
              style={{ fontSize: '20px', color: C.blueDeep }}
            >
              ¥
              {yen(
                ocr.parsed.rate === 'mixed'
                  ? (ocr.parsed.incl8 || 0) + (ocr.parsed.incl10 || 0)
                  : ocr.parsed.incl,
              )}
            </p>
          </div>
        )}

        <button
          onClick={handleUse}
          disabled={ocr.loading}
          className="mt-4 w-full py-3.5 text-sm font-semibold disabled:opacity-40"
          style={{ backgroundColor: C.blue, color: '#FFFFFF' }}
        >
          {ocr.loading
            ? t.ocrRecognizing
            : ocrHasAmount
              ? t.useWithAmount
              : t.useOnly}
        </button>
      </div>
    </FullScreenSheet>

    {guard.discardOpen && (
      <DiscardConfirmSheet
        t={t}
        onKeepEditing={guard.keepEditing}
        onDiscard={guard.discard}
      />
    )}
    </>
  );
}

function DetailSheet({
  t,
  item,
  group,
  photos,
  onPhotosChange,
  taxOf,
  settings,
  hasDeparture,
  onClose,
  onEdit,
  onStatus,
  onDelete,
  onPhotoPermissionPrimed,
}) {
  const d = daysLeft(item.date);
  const tax = taxOf(item);
  const consumedDead = !!item.consumed;
  // 跟 ReceiptCard/isExpiredUnclaimed 同一套判斷：已查驗/已退款的收據
  // 就算超過 90 天也不算「來不及」，錢已經到手或查驗過了；只有還卡在
  // 購買/登記階段、又超過 90 天的才算真的錯過。
  const expiredDead =
    !consumedDead &&
    item.status !== 'refunded' &&
    item.status !== 'verified' &&
    d !== null &&
    d < 0;
  const dead = consumedDead || expiredDead;
  const groupOk = !!(group && group.ok);
  const blocked = dead || !groupOk;
  const cur = STAGES.indexOf(item.status);
  const refunded = item.status === 'refunded';
  const [lightboxIndex, setLightboxIndex] = useState(null);
  useBackClose(lightboxIndex !== null, () => setLightboxIndex(null));
  const cap = usePhotoCapture({
    imgs: photos,
    setImgs: (updater) => onPhotosChange(typeof updater === 'function' ? updater(photos) : updater),
    permissionPrimed: settings.photoPermissionPrimed,
    onPrimed: onPhotoPermissionPrimed,
  });
  const fmtShort = (iso) => {
    const dt = new Date(iso + 'T00:00:00');
    return `${dt.getMonth() + 1}/${dt.getDate()}`;
  };
  const strike = {
    textDecoration: 'line-through',
    textDecorationColor: C.clay,
  };

  return (
    <>
    <FullScreenSheet>
      <div
        className="sticky top-0 z-10 flex items-center justify-between kaeru-pad"
        style={{
          backgroundColor: C.page,
          borderBottom: `1px solid ${C.line}`,
          paddingTop: 'max(16px, env(safe-area-inset-top))',
          paddingBottom: '16px',
        }}
      >
        <button
          onClick={onClose}
          className="font-semibold"
          style={{ fontSize: '13px', color: C.blueDeep, minHeight: '44px' }}
        >
          ‹ {t.receipts}
        </button>
        <div className="flex items-center gap-4">
          <button
            onClick={() => onEdit(item)}
            className="font-semibold"
            style={{ fontSize: '13px', color: C.blueDeep }}
          >
            {t.edit}
          </button>
          <button onClick={onDelete} style={{ fontSize: '13px', color: C.clayInk }}>
            {t.delete}
          </button>
        </div>
      </div>

      <div className="kaeru-pad py-6">
        <h1 className="font-bold" style={{ fontSize: '19px' }}>
          {item.shop}
        </h1>
        <p
          className="mt-1.5 tabular-nums"
          style={{ color: C.sub, fontSize: '11.5px' }}
        >
          {item.date}
          {dead
            ? ` · ${consumedDead ? t.stalledShort : t.expiredBadge}`
            : refunded
              ? ` · ${t.caseClosed}`
              : !hasDeparture
                // 沒有回程時間，「剩 N 天」這個數字沒有實際意義（見
                // CLAUDE_CODE_DELTA_未設定回程時間.md），跟清單卡片的
                // 「期限待定」用同一句話，不要另外顯示一個猜出來的天數。
                ? ` · ${t.deadlinePendingBadge}`
                : // d < 0 在這裡代表「已查驗但超過 90 天」（expiredDead 已經
                  // 排除掉這個狀態）——deadline 對已查驗的收據沒有意義了，
                  // 不要顯示負數天數，乾脆不顯示這段。
                  d !== null && d >= 0
                  ? ` · ${t.warnDeadline} ${d} ${t.days}`
                  : ''}
        </p>

        <div
          className="mt-4 flex items-end justify-between gap-4"
          style={{ borderTop: `1px solid ${C.ink}`, paddingTop: '14px' }}
        >
          <div>
            <p style={{ color: C.sub, fontSize: '11.5px' }}>{t.inclAmount}</p>
            <p
              className="mt-1 font-semibold tabular-nums"
              style={{
                fontSize: '26px',
                color: dead ? C.sub : C.ink,
                ...(dead ? strike : {}),
              }}
            >
              ¥{yen(item.incl)}
            </p>
          </div>
          <div className="text-right">
            <p style={{ color: C.sub, fontSize: '11.5px' }}>
              {dead
                ? `${t.taxAmount} ${t.lostTax}`
                : refunded
                  ? `${t.checkRefunded} ≈ NT$${twd(tax * settings.rate)}`
                  : `${t.taxAmount} ≈ NT$${twd(tax * settings.rate)}`}
            </p>
            <p
              className="mt-1 font-semibold tabular-nums"
              style={{
                fontSize: '26px',
                color: dead ? C.sub : C.blueDeep,
                ...(dead ? strike : {}),
              }}
            >
              ¥{yen(tax)}
            </p>
          </div>
        </div>

        <div
          className="mt-3 grid grid-cols-3 gap-2"
          style={{
            fontSize: '11.5px',
            color: C.sub,
            borderTop: `1px solid ${C.line}`,
            paddingTop: '10px',
          }}
        >
          <span>
            {t.taxRate}{' '}
            {item.rate === 'mixed' ? '8% / 10%' : item.rate ? `${item.rate}%` : t.unfilled}
          </span>
          <span>
            {t.netAmount} ¥{yen(netOfItem(item))}
          </span>
          <span>
            {t.groupTotal} ¥{yen(group ? group.net : netOfItem(item))}
          </span>
        </div>

        <div className="mt-4 flex flex-wrap gap-1.5">
          {consumedDead ? (
            <>
              <Badge tone="clay">{t.consumedShort}</Badge>
              <Badge tone="clay">{t.dead}</Badge>
              {item.unpacked && <Badge tone="outline">{t.unpackedShort}</Badge>}
            </>
          ) : expiredDead ? (
            <>
              <Badge tone="clay">{t.expiredBadge}</Badge>
              {item.unpacked && <Badge tone="outline">{t.unpackedShort}</Badge>}
              {item.refundMethod === 'registered' && (
                <Badge tone="outline">{t.refundReg}</Badge>
              )}
            </>
          ) : refunded ? (
            <Badge tone="sage">{t.stage.refunded}</Badge>
          ) : (
            <>
              {groupOk ? (
                <Badge tone="sage">{t.reachedShort}</Badge>
              ) : (
                <Badge tone="clay">{t.notReached}</Badge>
              )}
              {!blocked && cur < 2 && (
                <Badge tone="blue">{t.pendingCheck}</Badge>
              )}
              {item.unpacked && <Badge tone="outline">{t.unpackedShort}</Badge>}
              {item.refundMethod === 'registered' && (
                <Badge tone="outline">{t.refundReg}</Badge>
              )}
            </>
          )}
        </div>

        <div className="mt-8">
          <p
            className="font-bold"
            style={{
              color: C.blue,
              fontSize: '10.5px',
              letterSpacing: '0.22em',
            }}
          >
            {t.status}
          </p>
          <div className="mt-3">
            {STAGES.map((s, i) => {
              const reached = i <= cur;
              const isCur = i === cur && !dead;
              // 只有真的在境內消費（consumedDead）才把整條進度收縮成
              // 「卡在第一步」——那是整張作廢，走到哪一步不重要。過期
              // 未退（expiredDead）沒有這回事，它就真的停在購買或登記
              // 那一步（expiredDead 的定義本來就排除了 verified/
              // refunded），照實際走到哪一步顯示就好，不用假裝退回第
              // 一步。
              const stalledRow = consumedDead && i === 1;
              const dis = blocked && i >= 2;
              const label = stalledRow ? t.stalledShort : t.stage[s];
              const sqStyle = stalledRow
                ? {
                    border: `1px solid ${C.clay}`,
                    backgroundColor: 'transparent',
                  }
                : consumedDead && i > 1
                  ? {
                      border: `1px solid ${C.line}`,
                      backgroundColor: 'transparent',
                    }
                  : consumedDead && i === 0
                    ? { border: `1px solid ${C.clay}`, backgroundColor: C.clay }
                    : reached && refunded
                      ? {
                          border: `1px solid ${C.sage}`,
                          backgroundColor: C.sage,
                        }
                      : reached
                        ? {
                            border: `1px solid ${C.blue}`,
                            backgroundColor: C.blue,
                          }
                        : {
                            border: `1px solid ${C.line}`,
                            backgroundColor: 'transparent',
                          };
              return (
                <button
                  key={s}
                  onClick={() => onStatus(s)}
                  disabled={dis}
                  className="flex w-full items-center gap-3 py-3 text-left"
                  style={{
                    backgroundColor:
                      isCur || stalledRow ? C.soft : 'transparent',
                    borderTop: `1px solid ${i === 0 ? C.ink : C.line}`,
                    ...(isCur || stalledRow
                      ? {
                          margin: '0 -8px',
                          paddingLeft: '8px',
                          paddingRight: '8px',
                        }
                      : {}),
                  }}
                >
                  <span
                    className="shrink-0"
                    style={{ width: '9px', height: '9px', ...sqStyle }}
                  />
                  <span
                    className="flex-1"
                    style={{
                      fontSize: '15px',
                      fontWeight: isCur || stalledRow ? 700 : 400,
                      color: stalledRow ? C.clayInk : reached ? C.ink : C.sub,
                    }}
                  >
                    {label}
                  </span>
                  <span className="shrink-0" style={{ fontSize: '12px' }}>
                    {stalledRow ? (
                      <Badge tone="clay">{t.cantRefund}</Badge>
                    ) : isCur && refunded ? (
                      <Badge tone="sage">{t.checkDone}</Badge>
                    ) : isCur ? (
                      <Badge tone="blue">{t.currentTag}</Badge>
                    ) : dis ? (
                      <span style={{ color: C.sub }}>—</span>
                    ) : reached ? (
                      i === 0 && (
                        <span className="tabular-nums" style={{ color: C.sub }}>
                          {fmtShort(item.date)}
                        </span>
                      )
                    ) : (
                      <span
                        className="flex items-center gap-0.5"
                        style={{ color: C.blueDeep }}
                      >
                        {t.markTag} <ChevronRight size={12} />
                      </span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {consumedDead ? (
          <>
            <p
              className="mt-6"
              style={{
                backgroundColor: C.soft,
                borderLeft: `3px solid ${C.clay}`,
                color: C.clayInk,
                fontSize: '13px',
                lineHeight: 2,
                padding: '14px',
              }}
            >
              {t.warnConsumed}
            </p>
            <p
              className="mt-3"
              style={{ color: C.sub, fontSize: '12px', lineHeight: 1.8 }}
            >
              {t.packNoteShort}
            </p>
          </>
        ) : expiredDead ? (
          <p
            className="mt-6"
            style={{
              backgroundColor: C.soft,
              borderLeft: `3px solid ${C.clay}`,
              color: C.clayInk,
              fontSize: '13px',
              lineHeight: 2,
              padding: '14px',
            }}
          >
            {t.expired}
          </p>
        ) : refunded ? (
          <p
            className="mt-6"
            style={{
              backgroundColor: C.soft,
              color: C.ink,
              fontSize: '13px',
              lineHeight: 2,
              padding: '14px',
            }}
          >
            {t.refundedNote}
          </p>
        ) : (
          <p
            className="mt-6"
            style={{
              backgroundColor: C.soft,
              color: C.ink,
              fontSize: '13px',
              lineHeight: 2,
              padding: '14px',
            }}
          >
            {t.packNote}
          </p>
        )}

        {item.note && (
          <p
            className="mt-4"
            style={{ color: C.sub, fontSize: '13px', lineHeight: 1.8 }}
          >
            {item.note}
          </p>
        )}

        {!dead && (
          <PhotoAttachments
            t={t}
            photos={photos}
            cap={cap}
            onOpenLightbox={setLightboxIndex}
          />
        )}
      </div>
    </FullScreenSheet>

    <PhotoCaptureSheets t={t} cap={cap} />

    {lightboxIndex !== null && (
      <PhotoLightbox
        t={t}
        shop={item.shop}
        date={item.date}
        photos={photos}
        index={lightboxIndex}
        onIndexChange={setLightboxIndex}
        onClose={() => setLightboxIndex(null)}
        onDeletePhoto={(i) => {
          const willBeEmpty = photos.length <= 1;
          cap.removeImg(i);
          if (willBeEmpty) setLightboxIndex(null);
          else setLightboxIndex((idx) => Math.min(idx, photos.length - 2));
        }}
        onRotatePhoto={async (i) => {
          try {
            const rotated = await rotateImageSrc(photos[i].src, 90);
            onPhotosChange(photos.map((p, pi) => (pi === i ? { ...p, src: rotated } : p)));
          } catch (e) {}
        }}
      />
    )}
    </>
  );
}

// 一張照片是「收據照片」（憑證，跑過 OCR、是金額來源）還是「物品照片」
// （純備忘，不跑辨識、不影響金額）——長按縮圖跳出來的小選單，兩者互斥、
// 選了就換，跟 BottomSheet 裡其他「選單式」動作用同一套視覺語言。
function PhotoTypeSheet({ t, current, onPick, onClose }) {
  return (
    <BottomSheet onClose={onClose}>
      <div className="flex items-center justify-between">
        <h2 className="font-bold" style={{ fontSize: '18px' }}>
          {t.photoTypeSheetTitle}
        </h2>
        <button onClick={onClose} style={{ color: C.sub }}>
          <X size={18} />
        </button>
      </div>
      <div className="mt-3">
        {[
          { v: 'receipt', label: t.photoTypeReceiptLabel, hint: t.photoTypeReceiptHint },
          { v: 'item', label: t.photoTypeItemLabel, hint: t.photoTypeItemHint },
        ].map((opt, i) => (
          <button
            key={opt.v}
            onClick={() => onPick(opt.v)}
            className="flex w-full items-center justify-between py-4 text-left"
            style={{ borderTop: `1px solid ${i === 0 ? C.ink : C.line}` }}
          >
            <span>
              <span
                className="block font-bold"
                style={{ fontSize: '15px', color: current === opt.v ? C.blueDeep : C.ink }}
              >
                {opt.label}
              </span>
              <span className="block" style={{ fontSize: '11.5px', color: C.sub }}>
                {opt.hint}
              </span>
            </span>
            {current === opt.v && <CheckCircle2 size={16} style={{ color: C.blueDeep, flexShrink: 0 }} />}
          </button>
        ))}
      </div>
    </BottomSheet>
  );
}

// 附件區共用元件：DetailSheet／EditSheet 都用這個，兩邊的照片型別呈現
// 要一致，不要各刻一份各長各的樣。收據照片（憑證）跟物品照片（備忘）
// 分兩組顯示；型別隨時可以長按縮圖切換——使用者不用在拍照前先決定要
// 拍哪一種，那個決定放在拍完之後。
function PhotoAttachments({ t, photos, cap, onOpenLightbox }) {
  const [typeSheetIndex, setTypeSheetIndex] = useState(null);
  const withIndex = photos.map((p, i) => ({ ...p, i }));
  const receiptPhotos = withIndex.filter((p) => p.type !== 'item');
  const itemPhotos = withIndex.filter((p) => p.type === 'item');

  // 長按跟點擊共用同一個 pointerdown——480ms 內放開算一般點擊（開放大
  // 檢視），撐過 480ms 才算長按（跳型別選單）。用一個 ref 記有沒有真的
  // 觸發長按，觸發了就在 onClick 那端把這次點擊吃掉，不會長按完又順便
  // 開了放大檢視。
  const pressTimer = useRef(null);
  const longPressed = useRef(false);
  function startPress(i) {
    longPressed.current = false;
    pressTimer.current = setTimeout(() => {
      longPressed.current = true;
      setTypeSheetIndex(i);
    }, 480);
  }
  function clearPress() {
    clearTimeout(pressTimer.current);
  }
  function tapTile(i) {
    if (longPressed.current) {
      longPressed.current = false;
      return;
    }
    onOpenLightbox(i);
  }

  function Tile({ item, receiptShape }) {
    const isReceipt = item.type !== 'item';
    return (
      <div
        onPointerDown={() => startPress(item.i)}
        onPointerUp={clearPress}
        onPointerLeave={clearPress}
        onPointerCancel={clearPress}
        onClick={() => tapTile(item.i)}
        // 手機瀏覽器/WebView 對「長按圖片」本來就有自己的原生手勢
        // （iOS 會跳出預覽＋分享選單、Android 會跳出「儲存圖片」選單）
        // ——沒擋掉的話，原生那套會搶在我們自己的 480ms 計時器前面跳
        // 出來，長按改型別在真機上根本按不到，即使桌機瀏覽器測起來
        // 一切正常（桌機沒有這個原生手勢，才會測不出這個問題）。
        // touchAction: none 順便擋掉滑動手勢把長按誤判成放棄。
        onContextMenu={(e) => e.preventDefault()}
        className="relative shrink-0"
        style={{
          width: '74px',
          height: receiptShape ? '96px' : '74px',
          backgroundColor: C.soft,
          border: `1px solid ${isReceipt ? C.ink : C.line}`,
          cursor: 'pointer',
          touchAction: 'none',
          WebkitTouchCallout: 'none',
          WebkitUserSelect: 'none',
          userSelect: 'none',
        }}
      >
        <img
          src={item.src}
          alt=""
          draggable={false}
          className="h-full w-full object-cover"
          style={{ WebkitTouchCallout: 'none', pointerEvents: 'none' }}
        />
        {isReceipt && (
          <span
            className="absolute bottom-0 left-0 font-semibold"
            style={{ fontSize: '9px', color: '#FFFFFF', backgroundColor: C.blue, padding: '2px 5px' }}
          >
            {t.photoTypeReceiptBadge}
          </span>
        )}
        <button
          onClick={(e) => {
            e.stopPropagation();
            cap.removeImg(item.i);
          }}
          // 刪除鈕疊在縮圖上面，pointerdown 沒擋住的話會先冒泡到外層
          // div 啟動長按計時器——手比較慢地按住這顆鈕，會變成「刪除同
          // 時跳出改型別選單」，兩個動作搶在一起。這裡直接不讓它冒泡。
          onPointerDown={(e) => e.stopPropagation()}
          className="absolute flex items-center justify-center"
          style={{
            top: '-1px',
            right: '-1px',
            width: '40px',
            height: '40px',
            marginTop: '-10px',
            marginRight: '-10px',
            paddingBottom: '10px',
            paddingLeft: '10px',
          }}
        >
          <span
            className="flex items-center justify-center"
            style={{ width: '18px', height: '18px', backgroundColor: C.ink, color: '#FFFFFF' }}
          >
            <X size={11} />
          </span>
        </button>
      </div>
    );
  }

  return (
    <div className="mt-6">
      <div className="flex items-center justify-between">
        <p
          className="font-bold"
          style={{ color: C.blue, fontSize: '10.5px', letterSpacing: '0.22em' }}
        >
          {t.photoSectionLabel(photos.length)}
        </p>
        {photos.length > 0 && photos.length < MAX_PHOTOS && (
          <button
            onClick={cap.pickPhoto}
            className="font-semibold"
            style={{ color: C.blueDeep, fontSize: '12px' }}
          >
            {t.addPhotoCta}
          </button>
        )}
      </div>

      {photos.length === 0 ? (
        cap.photoDenied ? (
          <p className="mt-3" style={{ color: C.sub, fontSize: '13px', lineHeight: 1.8 }}>
            {cap.photoDenied === 'camera' ? t.cameraDenied : t.photoDenied}
            {'　'}
            <button
              onClick={() => ReceiptScanner.openAppSettings().catch(() => {})}
              style={{ color: C.blueDeep, textDecoration: 'underline' }}
            >
              {t.openSettings}
            </button>
          </p>
        ) : (
          <button
            onClick={cap.pickPhoto}
            className="mt-3 flex w-full items-center justify-center text-sm"
            style={{ border: `1px dashed ${C.line}`, color: C.sub, height: '74px' }}
          >
            {t.takePhoto}
          </button>
        )
      ) : (
        <>
          {receiptPhotos.length > 0 && (
            <div className="mt-3">
              <p style={{ fontSize: '11.5px', color: C.sub }}>
                {t.photoGroupReceipt(receiptPhotos.length)}
              </p>
              <div className="mt-1.5 flex flex-wrap gap-2">
                {receiptPhotos.map((p) => (
                  <Tile key={p.i} item={p} receiptShape />
                ))}
              </div>
            </div>
          )}
          {itemPhotos.length > 0 && (
            <div className="mt-3">
              <p style={{ fontSize: '11.5px', color: C.sub }}>
                {t.photoGroupItem(itemPhotos.length)}
              </p>
              <div className="mt-1.5 flex flex-wrap" style={{ gap: '9px' }}>
                {itemPhotos.map((p) => (
                  <Tile key={p.i} item={p} />
                ))}
                {photos.length < MAX_PHOTOS && (
                  <button
                    onClick={cap.pickPhoto}
                    className="flex shrink-0 items-center justify-center"
                    style={{ width: '74px', height: '74px', border: `1px dashed ${C.line}`, color: C.sub }}
                  >
                    <Plus size={16} />
                  </button>
                )}
              </div>
            </div>
          )}

          {cap.photoDenied ? (
            <p className="mt-2" style={{ color: C.sub, fontSize: '11.5px', lineHeight: 1.7 }}>
              {cap.photoDenied === 'camera' ? t.cameraDenied : t.photoDenied}
              {'　'}
              <button
                onClick={() => ReceiptScanner.openAppSettings().catch(() => {})}
                style={{ color: C.blueDeep, textDecoration: 'underline' }}
              >
                {t.openSettings}
              </button>
            </p>
          ) : (
            <p className="mt-2" style={{ color: C.sub, fontSize: '11.5px', lineHeight: 1.7 }}>
              {t.photoTypeHint}
            </p>
          )}

          <div className="mt-3" style={{ backgroundColor: C.soft, padding: '14px' }}>
            <p className="font-bold" style={{ fontSize: '13px', color: C.ink }}>
              {t.photoTypeWhyTitle}
            </p>
            <p className="mt-1.5" style={{ color: C.sub, fontSize: '11.5px', lineHeight: 1.8 }}>
              {t.photoTypeWhyDesc}
            </p>
          </div>
        </>
      )}

      <div className="mt-3" style={{ backgroundColor: C.soft, padding: '14px' }}>
        <p style={{ color: C.sub, fontSize: '11.5px', lineHeight: 1.8 }}>{t.photoStorageNote}</p>
      </div>

      <input
        ref={cap.fileRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={cap.onPick}
        className="hidden"
      />

      {typeSheetIndex !== null && (
        <PhotoTypeSheet
          t={t}
          current={photos[typeSheetIndex]?.type === 'item' ? 'item' : 'receipt'}
          onPick={(type) => {
            cap.retypeImg(typeSheetIndex, type);
            setTypeSheetIndex(null);
          }}
          onClose={() => setTypeSheetIndex(null)}
        />
      )}
    </div>
  );
}

// 畫面34：照片放大檢視。深色全螢幕，跟相機掃描是同一組深色語彙。
// 手勢：雙指縮放（追蹤兩個 pointer 的距離）、單指左右滑動換照片、
// 單指下滑關閉；縮放中不吃滑動手勢，兩者用「目前幾指按著」分流。
function PhotoLightbox({
  t,
  shop,
  date,
  photos,
  index,
  onIndexChange,
  onClose,
  onDeletePhoto,
  onRotatePhoto,
}) {
  const [scale, setScale] = useState(1);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [confirmDelete, setConfirmDelete] = useState(false);
  // 刪除照片的確認也掛進返回鍵堆疊——這個放大檢視本身的開關由外層
  // （DetailSheet/EditSheet）的 useBackClose 管，這裡另外多開一層只管
  // 確認面板自己，讓返回鍵先關掉確認、不要直接跳兩層關掉整個放大檢視。
  useBackClose(confirmDelete, () => setConfirmDelete(false));
  const [rotating, setRotating] = useState(false);
  const pointers = useRef(new Map());
  const pinchStart = useRef(null);
  const dragStart = useRef(null);

  useEffect(() => {
    setScale(1);
    setDragOffset({ x: 0, y: 0 });
  }, [index]);

  function fmtShort(iso) {
    const dt = new Date(iso + 'T00:00:00');
    return `${dt.getMonth() + 1}/${dt.getDate()}`;
  }

  function onPointerDownImg(e) {
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const pts = Array.from(pointers.current.values());
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      pinchStart.current = { dist, scale };
      dragStart.current = null;
    } else if (pointers.current.size === 1) {
      dragStart.current = { x: e.clientX, y: e.clientY };
    }
  }

  function onPointerMoveImg(e) {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2 && pinchStart.current) {
      const pts = Array.from(pointers.current.values());
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      setScale(
        Math.max(1, Math.min(4, pinchStart.current.scale * (dist / pinchStart.current.dist))),
      );
    } else if (pointers.current.size === 1 && dragStart.current && scale <= 1.05) {
      setDragOffset({
        x: e.clientX - dragStart.current.x,
        y: e.clientY - dragStart.current.y,
      });
    }
  }

  function onPointerUpImg(e) {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinchStart.current = null;
    if (pointers.current.size === 0) {
      if (dragStart.current && scale <= 1.05) {
        const { x: dx, y: dy } = dragOffset;
        if (Math.abs(dy) > Math.abs(dx) && dy > 90) {
          onClose();
        } else if (dx > 60 && index > 0) {
          onIndexChange(index - 1);
        } else if (dx < -60 && index < photos.length - 1) {
          onIndexChange(index + 1);
        }
      }
      setDragOffset({ x: 0, y: 0 });
      dragStart.current = null;
      if (scale <= 1.05) setScale(1);
    }
  }

  async function rotate() {
    setRotating(true);
    try {
      await onRotatePhoto(index);
    } finally {
      setRotating(false);
    }
  }

  const deleteBody = t.deletePhotoBody;

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col"
      style={{ backgroundColor: C.ink, fontFamily: FONT }}
    >
      <div
        className="flex items-center justify-between kaeru-pad py-3"
        style={{
          paddingTop: 'max(16px, calc(env(safe-area-inset-top) + 10px))',
          opacity: confirmDelete ? 0.4 : 1,
        }}
      >
        <button onClick={onClose} style={{ color: '#FFFFFF' }}>
          <X size={22} />
        </button>
        <div className="text-center">
          <p className="font-semibold" style={{ color: '#FFFFFF', fontSize: '13px' }}>
            {shop}
          </p>
          <p
            className="mt-0.5 tabular-nums"
            style={{ color: 'rgba(255,255,255,0.65)', fontSize: '11px' }}
          >
            {date} · {index + 1} ／ {photos.length}
          </p>
        </div>
        <span style={{ width: '22px' }} />
      </div>

      <div
        className="relative flex flex-1 items-center justify-center overflow-hidden"
        style={{ opacity: confirmDelete ? 0.4 : 1 }}
      >
        <button
          onClick={() => index > 0 && onIndexChange(index - 1)}
          disabled={index === 0}
          className="absolute left-3 top-1/2 z-10"
          style={{ color: '#FFFFFF', opacity: index === 0 ? 0.55 : 1, transform: 'translateY(-50%)' }}
        >
          <ChevronLeft size={26} />
        </button>
        <button
          onClick={() => index < photos.length - 1 && onIndexChange(index + 1)}
          disabled={index === photos.length - 1}
          className="absolute right-3 top-1/2 z-10"
          style={{
            color: '#FFFFFF',
            opacity: index === photos.length - 1 ? 0.55 : 1,
            transform: 'translateY(-50%)',
          }}
        >
          <ChevronRight size={26} />
        </button>

        <img
          src={photos[index]?.src}
          alt=""
          onPointerDown={onPointerDownImg}
          onPointerMove={onPointerMoveImg}
          onPointerUp={onPointerUpImg}
          onPointerCancel={onPointerUpImg}
          className="max-h-full max-w-full object-contain"
          style={{
            touchAction: 'none',
            opacity: rotating ? 0.5 : 1,
            transform: `translate(${dragOffset.x}px, ${dragOffset.y}px) scale(${scale})`,
            transition: scale === 1 && dragOffset.x === 0 && dragOffset.y === 0 ? 'transform 150ms' : 'none',
          }}
        />
      </div>

      <div style={{ opacity: confirmDelete ? 0.4 : 1 }}>
        {photos.length > 1 && (
          <div className="flex justify-center gap-1.5 pb-3">
            {photos.map((src, i) => (
              <button
                key={i}
                onClick={() => onIndexChange(i)}
                style={{
                  width: '26px',
                  height: '34px',
                  backgroundColor: i === index ? C.soft : '#5C5A54',
                  border: i === index ? '2px solid #FFFFFF' : 'none',
                }}
              />
            ))}
          </div>
        )}
        <div
          className="kaeru-pad flex items-start justify-between py-3"
          style={{
            borderTop: '1px solid rgba(255,255,255,0.25)',
            paddingBottom: 'max(16px, calc(env(safe-area-inset-bottom) + 10px))',
          }}
        >
          <div>
            <p style={{ color: 'rgba(255,255,255,0.75)', fontSize: '11.5px' }}>{t.zoomHint}</p>
            <p style={{ color: 'rgba(255,255,255,0.75)', fontSize: '11.5px' }}>{t.swipeHint}</p>
          </div>
          <div className="flex shrink-0 gap-4">
            <button onClick={rotate} className="font-semibold" style={{ color: '#FFFFFF', fontSize: '12.5px' }}>
              {t.toolRotate}
            </button>
            <button
              onClick={() => setConfirmDelete(true)}
              className="font-bold"
              style={{ color: '#DCC0A8', fontSize: '12.5px' }}
            >
              {t.delete}
            </button>
          </div>
        </div>
      </div>

      {confirmDelete && (
        <div className="absolute inset-0 z-20" style={{ backgroundColor: 'rgba(73,70,64,0.55)' }}>
          <div
            className="absolute inset-x-0 bottom-0 kaeru-pad"
            style={{
              backgroundColor: '#FFFFFF',
              borderTop: '1px solid #494640',
              paddingTop: '22px',
              paddingBottom: 'max(22px, env(safe-area-inset-bottom))',
            }}
          >
            <h2 className="font-bold" style={{ fontSize: '18px', color: C.ink }}>
              {t.deletePhotoTitle}
            </h2>
            <p className="mt-2" style={{ color: C.sub, fontSize: '12.5px', lineHeight: 1.9 }}>
              {deleteBody}
            </p>
            <div
              className="mt-4 flex gap-2"
              style={{ borderTop: '1px solid #494640', paddingTop: '14px' }}
            >
              <button
                onClick={() => setConfirmDelete(false)}
                className="flex-1 py-3 text-sm"
                style={{ border: `1px solid ${C.line}`, color: C.sub }}
              >
                {t.cancel}
              </button>
              <button
                onClick={() => {
                  setConfirmDelete(false);
                  onDeletePhoto(index);
                }}
                className="flex-1 py-3 text-sm font-bold"
                style={{ backgroundColor: C.clay, color: '#FFFFFF' }}
              >
                {t.delete}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
