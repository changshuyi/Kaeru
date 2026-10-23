import { useRef, useState } from 'react';
import { Camera, Receipt, ListChecks } from 'lucide-react';
import { C, FONT } from '../../constants/theme.js';
import { FrogMark } from '../ui/FrogMark.jsx';

// 首次開啟介紹：全新安裝第一次打開 App 才出現，看完或略過就不再出現
// （settings.introSeen）。四頁左右滑或按「下一步」，語言可以在這裡
// 直接切——第一次打開還沒機會去設定頁，日本使用者不該被迫先讀完一
// 整套中文。不用 FullScreenSheet：那個是內容多高就多高、下面露灰底，
// 這裡要整屏白底、按鈕固定在底部。
const ICONS = [null, Camera, Receipt, ListChecks];

export function IntroScreen({ t, lang, onLang, onDone }) {
  const [page, setPage] = useState(0);
  const touchX = useRef(null);
  const pages = t.introPages;
  const last = page === pages.length - 1;
  const p = pages[page];
  const Icon = ICONS[page];

  function go(n) {
    setPage(Math.max(0, Math.min(pages.length - 1, n)));
  }

  return (
    <div
      className="fixed inset-0 z-50 flex justify-center"
      style={{ backgroundColor: C.page, color: C.ink, fontFamily: FONT, letterSpacing: '0.01em' }}
      onTouchStart={(e) => {
        touchX.current = e.touches[0].clientX;
      }}
      onTouchEnd={(e) => {
        if (touchX.current === null) return;
        const dx = e.changedTouches[0].clientX - touchX.current;
        touchX.current = null;
        if (Math.abs(dx) < 50) return;
        go(page + (dx < 0 ? 1 : -1));
      }}
    >
      <div
        className="kaeru-pad flex w-full flex-col"
        style={{
          maxWidth: '480px',
          paddingTop: 'max(14px, env(safe-area-inset-top))',
          paddingBottom: 'max(24px, env(safe-area-inset-bottom))',
        }}
      >
        <div className="flex items-center justify-between" style={{ height: '44px' }}>
          <div className="flex gap-4">
            {[
              ['zh', '中文'],
              ['ja', '日本語'],
            ].map(([k, label]) => (
              <button
                key={k}
                onClick={() => onLang(k)}
                style={{
                  fontSize: '12.5px',
                  fontWeight: lang === k ? 700 : 400,
                  color: lang === k ? C.ink : C.sub,
                }}
              >
                {label}
              </button>
            ))}
          </div>
          {!last && (
            <button
              onClick={onDone}
              className="font-semibold"
              style={{ fontSize: '12.5px', color: C.blueDeep }}
            >
              {t.introSkip}
            </button>
          )}
        </div>

        <div className="flex flex-1 flex-col justify-center" style={{ minHeight: 0 }}>
          <div
            className="flex items-center justify-center"
            style={{ width: '72px', height: '72px', backgroundColor: page === 0 ? 'transparent' : C.soft }}
          >
            {Icon ? (
              <Icon size={30} strokeWidth={1.6} color={C.blueDeep} />
            ) : (
              <FrogMark size={64} />
            )}
          </div>

          <p
            className="mt-7 font-bold"
            style={{ color: C.blue, fontSize: '10.5px', letterSpacing: '0.24em' }}
          >
            {p.kicker}
          </p>
          <h1
            className="mt-3 font-bold"
            style={{ fontSize: '25px', lineHeight: 1.45 }}
          >
            {/* 標題只在換行和「、」之後斷，窄螢幕不會剩一兩個字掉到下一行 */}
            {p.title.split('\n').map((line, i) => (
              <span key={i} className="block">
                {line.split(/(?<=、)/).map((seg, j) => (
                  <span key={j} className="inline-block">
                    {seg}
                  </span>
                ))}
              </span>
            ))}
          </h1>
          <p className="mt-4" style={{ fontSize: '13.5px', lineHeight: 1.95, color: C.sub }}>
            {p.desc}
          </p>
          {last && (
            <p
              className="mt-6"
              style={{
                backgroundColor: C.soft,
                padding: '14px',
                fontSize: '12px',
                lineHeight: 1.8,
                color: C.sub,
              }}
            >
              {t.introPrivacy}
            </p>
          )}
        </div>

        <div className="flex justify-center gap-2" style={{ marginBottom: '20px' }}>
          {pages.map((_, i) => (
            <button
              key={i}
              onClick={() => go(i)}
              aria-label={`${i + 1} / ${pages.length}`}
              style={{
                width: i === page ? '18px' : '6px',
                height: '6px',
                backgroundColor: i === page ? C.ink : C.line,
                transition: 'width 200ms',
              }}
            />
          ))}
        </div>

        <button
          onClick={() => (last ? onDone() : go(page + 1))}
          className="w-full py-3.5 font-bold"
          style={{ backgroundColor: C.blue, color: '#FFFFFF', fontSize: '14px' }}
        >
          {last ? t.introStart : t.introNext}
        </button>
      </div>
    </div>
  );
}
