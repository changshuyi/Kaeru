import { useState } from 'react';
import { X } from 'lucide-react';
import { C } from '../../constants/theme.js';
import { useBackClose } from '../../hooks/useBackNav.js';
import { BottomSheet } from '../ui/BottomSheet.jsx';
import { Badge } from '../ui/Badge.jsx';
import { SectionLabel } from '../ui/SectionLabel.jsx';
import { Input } from '../ui/Input.jsx';
import { DateField } from '../ui/DateField.jsx';

export function TripSheet({
  t,
  trips,
  activeId,
  items,
  onClose,
  onSelect,
  onCreate,
  onDelete,
  onEditTrip,
}) {
  const [name, setName] = useState('');
  const [departure, setDeparture] = useState('');
  const [confirmId, setConfirmId] = useState(null);
  // 刪除確認掛進返回鍵堆疊——不掛的話,使用者在看到「確定要刪除嗎」
  // 那一刻按返回鍵，會直接跳過這層確認、關掉整層行程切換面板。
  useBackClose(confirmId, () => setConfirmId(null));

  const countOf = (id) => items.filter((i) => i.tripId === id).length;
  const fmtDep = (v) =>
    `${v.slice(0, 10).replace(/-/g, '/')} ${v.slice(11, 16)}`;
  const active = trips.find((x) => x.id === activeId);
  const others = [...trips]
    .filter((x) => x.id !== activeId)
    .sort((a, b) => (b.departure || '').localeCompare(a.departure || ''));

  return (
    <BottomSheet onClose={onClose}>
      <div className="flex items-center justify-between pb-4">
        <h2 className="font-bold" style={{ fontSize: '18px' }}>
          {t.trips}
        </h2>
        <button onClick={onClose} style={{ color: C.sub }}>
          <X size={20} />
        </button>
      </div>

      {active && (
        <div style={{ borderTop: `1px solid ${C.ink}`, paddingTop: '14px' }}>
          <button
            className="block w-full text-left"
            onClick={() => onEditTrip(active.id)}
          >
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-bold" style={{ fontSize: '17px' }}>
                {active.name || t.tripNow}
              </span>
              <Badge tone="blue">{t.tripNow}</Badge>
            </div>
            <p className="mt-1.5" style={{ color: C.sub, fontSize: '11.5px' }}>
              {countOf(active.id)} {t.tripReceipts}
              {active.departure
                ? ` · ${t.depPrefix} ${fmtDep(active.departure)}`
                : ` · ${t.noDeparture}`}
            </p>
          </button>

          {/* 只剩一個行程時不給刪，但不能完全不顯示——什麼都不說，使用者
              會以為介面壞了，猜不出是故意擋住。留一句說明講清楚規則跟
              解除方式（去新增一個），跟 TripEditSheet 的刪除保護同一套
              道理。 */}
          {trips.length <= 1 ? (
            <p className="mt-3" style={{ color: C.sub, fontSize: '11.5px', lineHeight: 1.7 }}>
              {t.tripDeleteMinNote}
            </p>
          ) : confirmId === active.id ? (
            <div
              className="mt-3"
              style={{
                backgroundColor: C.soft,
                borderLeft: `3px solid ${C.clay}`,
                padding: '12px 14px',
              }}
            >
              <p
                style={{
                  color: C.clayInk,
                  fontSize: '12.5px',
                  lineHeight: 1.7,
                }}
              >
                {t.deleteTripWarning(countOf(active.id))}
              </p>
              <div className="mt-2.5 flex gap-2">
                <button
                  onClick={() => {
                    onDelete(active.id);
                    setConfirmId(null);
                  }}
                  className="px-3 py-1.5 text-xs font-medium"
                  style={{
                    border: `1px solid ${C.clay}`,
                    color: C.clayInk,
                    borderRadius: 0,
                  }}
                >
                  {t.tripDelete}
                </button>
                <button
                  onClick={() => setConfirmId(null)}
                  className="px-3 py-1.5 text-xs"
                  style={{
                    border: `1px solid ${C.line}`,
                    color: C.ink,
                    borderRadius: 0,
                  }}
                >
                  {t.cancel}
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setConfirmId(active.id)}
              className="mt-3 flex w-full items-center justify-center py-2.5"
              style={{
                border: `1px solid ${C.line}`,
                color: C.sub,
                fontSize: '12.5px',
                borderRadius: 0,
              }}
            >
              {t.tripDelete}
            </button>
          )}
        </div>
      )}

      {others.length > 0 && (
        <div className="mt-6 pt-5" style={{ borderTop: `1px solid ${C.line}` }}>
          <SectionLabel>{t.tripPast}</SectionLabel>
          <div className="mt-1">
            {others.map((trip, idx) => (
              <div
                key={trip.id}
                className="flex items-baseline justify-between gap-3 py-3"
                style={idx > 0 ? { borderTop: `1px solid ${C.line}` } : {}}
              >
                <button
                  className="min-w-0 text-left"
                  onClick={() => onEditTrip(trip.id)}
                >
                  <p className="truncate" style={{ fontSize: '15px' }}>
                    {trip.name || t.tripNow}
                  </p>
                  <p
                    className="mt-0.5"
                    style={{ color: C.sub, fontSize: '11.5px' }}
                  >
                    {countOf(trip.id)} {t.tripReceipts}
                    {trip.departure &&
                      ` · ${t.depPrefix} ${fmtDep(trip.departure)}`}
                  </p>
                </button>
                <button
                  onClick={() => onSelect(trip.id)}
                  className="shrink-0"
                  style={{
                    color: C.blueDeep,
                    fontSize: '12.5px',
                    textDecoration: 'underline',
                  }}
                >
                  {t.tripSwitch}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mt-6 pt-5" style={{ borderTop: `1px solid ${C.ink}` }}>
        <SectionLabel>{t.newTrip}</SectionLabel>
        <div
          className="mt-4"
          style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}
        >
          <Input
            value={name}
            placeholder={`${t.tripName}　${t.tripNamePh}`}
            onChange={(e) => setName(e.target.value)}
          />
          <DateField
            withTime
            value={departure}
            onChange={setDeparture}
            t={t}
            fontSize="15px"
          />
          <button
            onClick={() => {
              if (!name.trim()) return;
              onCreate(name.trim(), departure);
              setName('');
              setDeparture('');
            }}
            disabled={!name.trim()}
            className="w-full py-3.5 text-sm font-semibold disabled:opacity-40"
            style={{
              backgroundColor: C.blue,
              color: '#FFFFFF',
              borderRadius: 0,
            }}
          >
            {t.create}
          </button>
        </div>
      </div>
    </BottomSheet>
  );
}
