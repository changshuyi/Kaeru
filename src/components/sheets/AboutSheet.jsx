import { ChevronRight, ChevronLeft } from 'lucide-react';
import { C } from '../../constants/theme.js';
import { APP_VERSION_DATE } from '../../constants/app.js';
import { FrogMark } from '../ui/FrogMark.jsx';
import { SectionLabel } from '../ui/SectionLabel.jsx';
import { FullScreenSheet } from '../ui/FullScreenSheet.jsx';

// 畫面 61：關於 Kaeru。三個 kaeru 那段是這頁的主體，用對照表而不是
// 散文——一句話講三個同音字會糊掉，三列一眼就看懂為什麼標誌是青蛙。
// 「不代辦退稅、不碰你的錢」要寫清楚：使用者裝一個退稅 App 的第一個
// 疑慮是「錢會不會經過你們」，這裡是回答這件事最合適的地方，比藏在
// 條款裡好。
export function AboutSheet({ t, onClose, onOpenPrivacy }) {
  const rows = [
    { kanji: t.aboutKanji1, romaji: t.aboutRomaji1, meaning: t.aboutMeaning1, desc: t.aboutMeaningDesc1 },
    { kanji: t.aboutKanji2, romaji: t.aboutRomaji2, meaning: t.aboutMeaning2, desc: t.aboutMeaningDesc2 },
    { kanji: t.aboutKanji3, romaji: t.aboutRomaji3, meaning: t.aboutMeaning3, desc: t.aboutMeaningDesc3 },
  ];
  return (
    <FullScreenSheet>
      <div
        className="sticky top-0 z-10 flex items-center kaeru-pad"
        style={{
          backgroundColor: C.page,
          borderBottom: `1px solid ${C.ink}`,
          paddingTop: 'max(16px, env(safe-area-inset-top))',
          paddingBottom: '16px',
        }}
      >
        <button
          onClick={onClose}
          className="flex items-center gap-0.5 font-semibold"
          style={{ fontSize: '13px', color: C.blueDeep }}
        >
          <ChevronLeft size={15} />
          {t.settings}
        </button>
      </div>

      <div className="kaeru-pad py-6">
        <div className="flex items-center gap-3">
          <FrogMark size={52} />
          <div>
            <p className="font-bold" style={{ fontSize: '15px', letterSpacing: '0.3em', color: C.blueDeep }}>
              KAERU
            </p>
            <p className="mt-1 tabular-nums" style={{ fontSize: '11.5px', color: C.sub }}>
              {t.aboutVersion('1.0.0', APP_VERSION_DATE)}
            </p>
          </div>
        </div>

        <div className="mt-7" style={{ borderTop: `1px solid ${C.ink}`, paddingTop: '16px' }}>
          <SectionLabel>{t.aboutNameOriginKicker}</SectionLabel>
          <p className="mt-3" style={{ fontSize: '13px', color: C.ink, lineHeight: 1.9 }}>
            {t.aboutNameOriginDesc}
          </p>
          <div className="mt-2">
            {rows.map((r, i) => (
              <div
                key={i}
                className="flex items-baseline justify-between gap-3"
                style={{
                  padding: '14px 0',
                  borderBottom: i < rows.length - 1 ? `1px solid ${C.line}` : 'none',
                }}
              >
                <div className="flex items-baseline gap-2">
                  <span className="font-bold" style={{ fontSize: '19px', color: C.ink }}>
                    {r.kanji}
                  </span>
                  <span style={{ fontSize: '11px', color: C.sub }}>{r.romaji}</span>
                </div>
                <div className="text-right">
                  <p className="font-semibold" style={{ fontSize: '13.5px', color: C.ink }}>
                    {r.meaning}
                  </p>
                  <p className="mt-0.5" style={{ fontSize: '11px', color: C.sub }}>
                    {r.desc}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-7" style={{ borderTop: `1px solid ${C.ink}`, paddingTop: '16px' }}>
          <SectionLabel>{t.aboutWhatKicker}</SectionLabel>
          <p className="mt-3" style={{ fontSize: '13px', color: C.ink, lineHeight: 1.9 }}>
            {t.aboutWhatDesc}
          </p>
          <p className="mt-3" style={{ fontSize: '12.5px', color: C.sub, lineHeight: 1.85 }}>
            {t.aboutWhatBoundary}
          </p>
        </div>

        <div className="mt-6" style={{ backgroundColor: C.soft, padding: '14px' }}>
          <p className="font-bold" style={{ fontSize: '13px', color: C.ink }}>
            {t.aboutEstimateTitle}
          </p>
          <p className="mt-1.5" style={{ color: C.sub, fontSize: '11.5px', lineHeight: 1.8 }}>
            {t.aboutEstimateDesc}
          </p>
        </div>

        <div className="mt-6" style={{ borderTop: `1px solid ${C.line}`, paddingTop: '4px' }}>
          <button
            onClick={onOpenPrivacy}
            className="flex w-full items-center justify-between"
            style={{ padding: '14px 0', borderBottom: `1px solid ${C.line}` }}
          >
            <span style={{ fontSize: '14px', color: C.ink }}>{t.aboutPrivacyLink}</span>
            <ChevronRight size={14} style={{ color: C.sub }} />
          </button>
          <div className="flex items-center justify-between" style={{ padding: '14px 0' }}>
            <span style={{ fontSize: '14px', color: C.ink }}>{t.aboutFeedbackLabel}</span>
            <a
              href={`mailto:${t.aboutFeedbackEmail}`}
              style={{ fontSize: '12.5px', color: C.blueDeep }}
            >
              {t.aboutFeedbackEmail}
            </a>
          </div>
        </div>
      </div>
    </FullScreenSheet>
  );
}
