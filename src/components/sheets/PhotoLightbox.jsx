import { useState, useEffect, useRef } from 'react';
import { X, ChevronLeft, ChevronRight } from 'lucide-react';
import { C, FONT } from '../../constants/theme.js';
import { useBackClose } from '../../hooks/useBackNav.js';

// 畫面34：照片放大檢視。深色全螢幕，跟相機掃描是同一組深色語彙。
// 手勢：雙指縮放（追蹤兩個 pointer 的距離）、單指左右滑動換照片、
// 單指下滑關閉；縮放中不吃滑動手勢，兩者用「目前幾指按著」分流。
export function PhotoLightbox({
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
