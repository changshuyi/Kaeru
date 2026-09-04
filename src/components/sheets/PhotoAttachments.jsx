import { useState, useRef } from 'react';
import { X, Plus } from 'lucide-react';
import { C } from '../../constants/theme.js';
import { MAX_PHOTOS } from '../../constants/app.js';
import ReceiptScanner from '../../receiptScanner.js';
import { PhotoTypeSheet } from './PhotoTypeSheet.jsx';

// 附件區共用元件：DetailSheet／EditSheet 都用這個，兩邊的照片型別呈現
// 要一致，不要各刻一份各長各的樣。收據照片（憑證）跟物品照片（備忘）
// 分兩組顯示；型別隨時可以長按縮圖切換——使用者不用在拍照前先決定要
// 拍哪一種，那個決定放在拍完之後。
export function PhotoAttachments({ t, photos, cap, onOpenLightbox }) {
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
