import { useState, useRef } from 'react';
import { ChevronRight } from 'lucide-react';
import { C } from '../../constants/theme.js';
import { AIRPORTS } from '../../constants/airports.js';
import { yen } from '../../lib/money.js';
import { useBackClose, useDirtyBackGuard } from '../../hooks/useBackNav.js';
import { FullScreenSheet } from '../ui/FullScreenSheet.jsx';
import { Field } from '../ui/Field.jsx';
import { Input } from '../ui/Input.jsx';
import { DateField } from '../ui/DateField.jsx';
import { Badge } from '../ui/Badge.jsx';
import { DiscardConfirmSheet } from '../ui/DiscardConfirmSheet.jsx';
import { AirportPickerSheet } from './AirportPickerSheet.jsx';

// 編輯行程：行程名稱／出發時間／出發機場／設為目前行程／這趟的收據統計／刪除行程
export function TripEditSheet({
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
