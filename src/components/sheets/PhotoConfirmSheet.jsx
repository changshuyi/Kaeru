import { useState, useEffect, useRef } from 'react';
import { C } from '../../constants/theme.js';
import { yen } from '../../lib/money.js';
import { compressImageSrc, perspectiveCrop, rotateCanvas, applyContrast } from '../../lib/image.js';
import { reconstructRowsFromLines, parseReceiptOCR, looksLikeReceiptText } from '../../lib/ocr.js';
import { useDirtyBackGuard } from '../../hooks/useBackNav.js';
import ReceiptScanner from '../../receiptScanner.js';
import { dataUrlBytes, formatBytes } from '../../exportData.js';
import { Badge } from '../ui/Badge.jsx';
import { FullScreenSheet } from '../ui/FullScreenSheet.jsx';
import { DiscardConfirmSheet } from '../ui/DiscardConfirmSheet.jsx';

// 畫面4：確認與裁切。四角把手是相對於「圖片自己實際渲染出來的那個框」
// 的百分比座標（0~1），拖曳時用 wrapperRef 量測出來的框反推百分比，
// 這樣不管圖片比例、螢幕大小都對得上，不用管 object-fit 的letterbox。
export function PhotoConfirmSheet({ t, src, fromScan, onRetake, onUse, onClose }) {
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
