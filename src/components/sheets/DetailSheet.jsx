import { useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { C } from '../../constants/theme.js';
import { STAGES } from '../../constants/app.js';
import { yen, twd, netOfItem } from '../../lib/money.js';
import { daysLeft } from '../../lib/date.js';
import { rotateImageSrc } from '../../lib/image.js';
import { useBackClose } from '../../hooks/useBackNav.js';
import { usePhotoCapture } from '../../hooks/usePhotoCapture.js';
import { Badge } from '../ui/Badge.jsx';
import { FullScreenSheet } from '../ui/FullScreenSheet.jsx';
import { PhotoAttachments } from './PhotoAttachments.jsx';
import { PhotoCaptureSheets } from './PhotoCaptureSheets.jsx';
import { PhotoLightbox } from './PhotoLightbox.jsx';

export function DetailSheet({
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
