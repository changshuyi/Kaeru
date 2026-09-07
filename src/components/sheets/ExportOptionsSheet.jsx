import { useState, useMemo } from 'react';
import { C } from '../../constants/theme.js';
import { todayStr } from '../../lib/date.js';
import { shareExportedFile } from '../../lib/share.js';
import { formatBytes, buildCsv, buildZip, estimateZipBytes, collectAllPhotos } from '../../exportData.js';
import { FullScreenSheet } from '../ui/FullScreenSheet.jsx';

// 畫面 59：匯出選項。CTA 文字跟著選中的格式變，數字都是這次真的會
// 匯出的內容算出來的，不是隨便寫的估計值。
export function ExportOptionsSheet({
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
