import { useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import ReceiptScanner from '../receiptScanner.js';
import { MAX_PHOTOS } from '../constants/app.js';
import { compressImage, compressImageSrc } from '../lib/image.js';
import { guessPhotoType } from '../lib/ocr.js';
import { useBackClose, deferOpen } from './useBackNav.js';

export function usePhotoCapture({
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
