import { useMemo } from 'react';
import { C } from '../../constants/theme.js';
import { formatBytes, isTripEnded, collectAllPhotos, photoStatsFrom } from '../../exportData.js';
import { CenterDialog } from '../ui/CenterDialog.jsx';

// 畫面 60：刪除確認。置中對話框，不做二次輸入確認——清單已經把後果
// 列完，再加一層是懲罰不是保護。「先匯出」故意比「刪除」顯眼：那是
// 唯一能救回資料的動作，使用者按到這一步通常沒想過要備份。
export function DeleteConfirmSheet({
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
