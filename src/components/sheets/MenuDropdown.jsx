import { Home, Rows3, ScanLine, HelpCircle, Settings as Cog, Plus, ChevronRight, Globe, MapPin } from 'lucide-react';
import { C } from '../../constants/theme.js';

export function MenuDropdown({
  t,
  lang,
  tab,
  trip,
  onClose,
  onGo,
  onAdd,
  onTrips,
  onLang,
}) {
  const rows = [
    ['home', Home],
    ['list', Rows3],
    ['check', ScanLine],
    ['faq', HelpCircle],
    ['set', Cog],
  ];

  const rowCls = 'flex w-full items-center gap-3 px-4 py-3 text-left';

  return (
    <>
      <style>{`@keyframes jpMenuIn{from{opacity:0;transform:translateY(-6px) scale(.98)}to{opacity:1;transform:none}}`}</style>

      <div className="fixed inset-0 z-30" onClick={onClose} />

      <div
        className="absolute right-0 z-40 overflow-hidden rounded-2xl"
        style={{
          top: 'calc(100% + 8px)',
          width: '17.5rem',
          maxWidth: 'calc(100vw - 2rem)',
          backgroundColor: C.card,
          border: `1px solid ${C.line}`,
          boxShadow: '0 12px 32px rgba(73,70,64,0.14)',
          transformOrigin: 'top right',
          animation: 'jpMenuIn 140ms ease-out',
        }}
      >
        <div className="p-3">
          <button
            onClick={onAdd}
            className="flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-semibold"
            style={{ backgroundColor: C.blue, color: '#FFFFFF' }}
          >
            <Plus size={16} /> {t.menuAdd}
          </button>
        </div>

        <div style={{ borderTop: `1px solid ${C.line}` }}>
          {rows.map(([k, Icon], i) => {
            const on = tab === k;
            return (
              <button
                key={k}
                onClick={() => onGo(k)}
                className={rowCls}
                style={{
                  borderTop: i === 0 ? 'none' : `1px solid ${C.line}`,
                  backgroundColor: on ? C.blueSoft : 'transparent',
                }}
              >
                <Icon
                  size={17}
                  style={{ color: on ? C.blue : C.sub }}
                  strokeWidth={on ? 2.2 : 1.7}
                />
                <span className="flex-1">
                  <span
                    className="block text-sm"
                    style={{ color: on ? C.blueDeep : C.ink }}
                  >
                    {t.nav[k]}
                  </span>
                  <span
                    className="mt-0.5 block text-xs leading-5"
                    style={{ color: C.sub }}
                  >
                    {t.navDesc[k]}
                  </span>
                </span>
              </button>
            );
          })}
        </div>

        <button
          onClick={onTrips}
          className={rowCls}
          style={{ borderTop: `1px solid ${C.line}` }}
        >
          <MapPin size={17} style={{ color: C.sub }} strokeWidth={1.7} />
          <span className="flex-1">
            <span className="block text-sm">{t.menuTrip}</span>
            <span className="mt-0.5 block text-xs" style={{ color: C.sub }}>
              {trip && trip.name ? trip.name : t.tripNow}
            </span>
          </span>
          <ChevronRight size={14} style={{ color: C.sub }} />
        </button>

        <button
          onClick={onLang}
          className={rowCls}
          style={{ borderTop: `1px solid ${C.line}` }}
        >
          <Globe size={17} style={{ color: C.sub }} strokeWidth={1.7} />
          <span className="flex-1 text-sm">{t.menuLang}</span>
          <span className="text-xs font-medium" style={{ color: C.blueDeep }}>
            {lang === 'zh' ? '日本語' : '中文'}
          </span>
        </button>
      </div>
    </>
  );
}
