import { useState, useRef } from 'react';
import { X } from 'lucide-react';
import { C, FONT } from '../../constants/theme.js';
import { AIRPORTS, AIRPORT_REGIONS, arriveHoursText, regionLabel } from '../../constants/airports.js';
import { findMatch } from '../../lib/search.js';
import { Highlight } from '../ui/Highlight.jsx';
import { Badge } from '../ui/Badge.jsx';

// 畫面36：出境機場選擇。日本機場太多，不適合塞進下拉選單，改成獨立的
// 整頁選擇畫面：搜尋 + 依地區分組。清單只放主要國際線機場，找不到就
// 選「其他機場」（等於不選，套用預設 3 小時）。
export function AirportPickerSheet({ t, selected, onClose, onPick }) {
  const [query, setQuery] = useState('');
  const sectionRefs = useRef({});

  const q = query.trim();
  const searching = q.length > 0;

  // 搜尋時是攤平的結果列表（不分組、不用籌碼跳轉，跟 37 號截圖一致）；
  // 沒搜尋時照地區分組，籌碼列可以點了跳到對應那組。
  const results = searching
    ? AIRPORTS.map((a) => {
        const cityText = a.citySearchLabel || a.city;
        const nameM = findMatch(a.name, q);
        const cityM = !nameM ? findMatch(cityText, q) : null;
        const codeM = !nameM && !cityM ? findMatch(a.code, q) : null;
        return { a, cityText, nameM, cityM, codeM, hit: !!(nameM || cityM || codeM) };
      }).filter((r) => r.hit)
    : null;

  const groups = !searching
    ? AIRPORT_REGIONS.map((region) => ({
        region,
        airports: AIRPORTS.filter((a) => a.region === region.key),
      })).filter((g) => g.airports.length > 0)
    : null;

  function scrollTo(key) {
    sectionRefs.current[key]?.scrollIntoView({ block: 'start' });
  }

  function row(a, extra) {
    const isSel = selected === a.code;
    return (
      <button
        key={a.code}
        onClick={() => onPick(a.code)}
        className="flex w-full items-center justify-between py-2.5 text-left"
        style={{ borderTop: `1px solid ${extra.first ? C.ink : C.line}` }}
      >
        <span className="min-w-0">
          <span
            className="block"
            style={{ fontSize: '14.5px', fontWeight: isSel ? 700 : 400, color: C.ink }}
          >
            <Highlight text={a.name} match={extra.nameM} />
          </span>
          <span className="mt-0.5 block" style={{ fontSize: '11px', color: C.sub }}>
            <Highlight text={extra.cityText || a.city} match={extra.cityM} /> · {t.arriveEarlyPrefix}{' '}
            {arriveHoursText(t, a.hours)}
            {extra.regionHeader && ` · ${extra.regionHeader}`}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-2.5">
          <span
            className="tabular-nums"
            style={{ fontSize: '12px', fontWeight: 700, color: C.sub, letterSpacing: '0.06em' }}
          >
            <Highlight text={a.code} match={extra.codeM} />
          </span>
          {isSel && <Badge tone="blue">{t.airportSelected}</Badge>}
        </span>
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-40 flex flex-col" style={{ backgroundColor: C.page, fontFamily: FONT }}>
      <div className="kaeru-app flex flex-1 flex-col" style={{ backgroundColor: C.page, minHeight: 0 }}>
        <div
          className="flex items-center justify-between kaeru-pad"
          style={{
            backgroundColor: C.page,
            borderBottom: `1px solid ${C.ink}`,
            paddingTop: 'max(18px, env(safe-area-inset-top))',
            paddingBottom: '14px',
          }}
        >
          <button
            onClick={onClose}
            className="flex items-center font-semibold"
            style={{ minWidth: '52px', minHeight: '44px', fontSize: '13px', color: C.blueDeep }}
          >
            ‹ {t.back}
          </button>
          <span className="font-bold" style={{ fontSize: '15px', color: C.ink }}>
            {t.airport}
          </span>
          <span style={{ width: '52px' }} />
        </div>

        <div className="kaeru-pad" style={{ paddingTop: '16px' }}>
          <div
            className="flex items-center justify-between"
            style={{ borderBottom: `1px solid ${C.line}`, paddingBottom: '9px' }}
          >
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t.airportSearchPh}
              className="w-full bg-transparent outline-none"
              style={{ border: 'none', fontSize: '15px', color: C.ink }}
            />
            {searching ? (
              <button onClick={() => setQuery('')} style={{ color: C.sub, flexShrink: 0 }}>
                <X size={15} />
              </button>
            ) : (
              <span style={{ fontSize: '12px', color: C.sub, flexShrink: 0 }}>⌕</span>
            )}
          </div>
          {searching ? (
            <p className="mt-2 tabular-nums" style={{ fontSize: '11.5px', color: C.sub }}>
              {t.airportResultCount(results.length)}
            </p>
          ) : (
            <p className="mt-2" style={{ fontSize: '11.5px', lineHeight: 1.75, color: C.sub }}>
              {t.airportSearchHint(AIRPORTS.length)}
            </p>
          )}
        </div>

        {!searching && (
          <div
            className="kaeru-pad no-scrollbar flex gap-1.5 overflow-x-auto"
            style={{ paddingTop: '12px', paddingBottom: '2px' }}
          >
            {AIRPORT_REGIONS.map((region) => (
              <button
                key={region.key}
                onClick={() => scrollTo(region.key)}
                className="shrink-0"
                style={{
                  fontSize: '12.5px',
                  padding: '6px 12px',
                  backgroundColor: C.soft,
                  border: `1px solid ${C.line}`,
                  color: C.sub,
                }}
              >
                {regionLabel(t, region, 'chip')}
              </button>
            ))}
          </div>
        )}

        <div className="kaeru-pad no-scrollbar flex-1 overflow-y-auto" style={{ minHeight: 0, paddingBottom: '8px' }}>
          {searching
            ? results.map(({ a, cityText, nameM, cityM, codeM }, i) =>
                row(a, {
                  first: i === 0,
                  cityText,
                  nameM,
                  cityM,
                  codeM,
                  regionHeader: regionLabel(
                    t,
                    AIRPORT_REGIONS.find((r) => r.key === a.region),
                    'header',
                  ),
                }),
              )
            : groups.map((g) => (
                <div
                  key={g.region.key}
                  ref={(el) => {
                    sectionRefs.current[g.region.key] = el;
                  }}
                  className="mt-3.5"
                >
                  <p
                    className="sticky font-bold"
                    style={{
                      top: 0,
                      backgroundColor: C.page,
                      color: C.blue,
                      fontSize: '10.5px',
                      letterSpacing: '0.22em',
                      paddingTop: '2px',
                      paddingBottom: '2px',
                    }}
                  >
                    {regionLabel(t, g.region, 'header')}
                  </p>
                  {g.airports.map((a, i) => row(a, { first: i === 0 }))}
                </div>
              ))}
        </div>

        <div
          className="kaeru-pad"
          style={{
            paddingTop: '14px',
            paddingBottom: 'max(28px, calc(env(safe-area-inset-bottom) + 16px))',
          }}
        >
          <p
            style={{
              borderTop: `1px solid ${C.ink}`,
              paddingTop: '13px',
              fontSize: '11.5px',
              lineHeight: 1.8,
              color: C.sub,
            }}
          >
            {searching ? t.airportItmNote : t.airportOtherHint}
          </p>
          <button
            onClick={() => onPick(null)}
            className="mt-2.5 font-semibold"
            style={{ fontSize: '13.5px', color: C.blueDeep }}
          >
            {t.airportOther} ›
          </button>
        </div>
      </div>
    </div>
  );
}
