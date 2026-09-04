import { useMemo } from 'react';
import { ChevronRight } from 'lucide-react';
import { C } from '../../constants/theme.js';
import { formatBytes, isTripEnded, collectAllPhotos, photoStatsFrom } from '../../exportData.js';
import { FullScreenSheet } from '../ui/FullScreenSheet.jsx';
import { SectionLabel } from '../ui/SectionLabel.jsx';

// 畫面 58：資料管理——匯出跟刪除的入口，兩件事故意放同一頁、份量
//相等（見 CLAUDE_CODE_DELTA_匯出與刪除.md）：純本機儲存讓匯出成為
// 唯一的備份手段，匯出不是附屬功能。
export function DataManageSheet({
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
