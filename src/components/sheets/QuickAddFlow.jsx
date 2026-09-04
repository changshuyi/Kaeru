import { useState, useEffect, useRef } from 'react';
import { Image as ImageIcon } from 'lucide-react';
import { C } from '../../constants/theme.js';
import { yen, netOf } from '../../lib/money.js';
import { todayStr } from '../../lib/date.js';
import { usePhotoCapture } from '../../hooks/usePhotoCapture.js';
import ReceiptScanner from '../../receiptScanner.js';
import { Badge } from '../ui/Badge.jsx';
import { Field } from '../ui/Field.jsx';
import { SectionLabel } from '../ui/SectionLabel.jsx';
import { FullScreenSheet } from '../ui/FullScreenSheet.jsx';
import { BottomSheet } from '../ui/BottomSheet.jsx';
import { PhotoCaptureSheets } from './PhotoCaptureSheets.jsx';

// 「+」的快路：拍照→OCR→存起來，晚點再補，跟完整表單並行存在，不取代
// 它。內部重用跟 EditSheet／DetailSheet 同一份 usePhotoCapture／
// PhotoCaptureSheets 拍照/選相簿/掃描/裁切/OCR 邏輯，外面包一個完全不同
// 的迷你表單——沒有店名/日期輸入框，也不能選稅率，OCR 讀到什麼就是
// 什麼，讀不到就掛「待補」標籤。
export function QuickAddFlow({
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
