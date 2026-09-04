import { ChevronLeft } from 'lucide-react';
import { C } from '../../constants/theme.js';
import { PRIVACY_UPDATED_AT } from '../../constants/app.js';
import { Badge } from '../ui/Badge.jsx';
import { SectionLabel } from '../ui/SectionLabel.jsx';
import { FullScreenSheet } from '../ui/FullScreenSheet.jsx';

// 畫面 56/57：隱私說明。白話版，不是條文——表格是這一頁的重點，一句
// 「我們重視你的隱私」沒有資訊量，六列各配一個標籤，使用者三秒就
// 掃完。標籤一律用線框，不要 clay 填色，這裡沒有一項是警示。
export function PrivacyInfoSheet({ t, onClose, onOpenDataManage }) {
  const rows = [
    { label: t.privacyRowAmount, badge: t.privacyBadgeLocalOnly, tone: 'local' },
    { label: t.privacyRowPhotos, badge: t.privacyBadgeLocalOnly, tone: 'local' },
    { label: t.privacyRowTripSettings, badge: t.privacyBadgeLocalOnly, tone: 'local' },
    { label: t.privacyRowOcr, badge: t.privacyBadgeOnDevice, tone: 'local' },
    { label: t.privacyRowRate, badge: t.privacyBadgeConnects, sub: t.privacyRowRateSub, tone: 'connects' },
    { label: t.privacyRowAnalytics, badge: t.privacyBadgeNone, tone: 'local' },
  ];
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
        <button
          onClick={onClose}
          className="flex items-center gap-0.5 font-semibold"
          style={{ fontSize: '13px', color: C.blueDeep }}
        >
          <ChevronLeft size={15} />
          {t.settings}
        </button>
        <span style={{ fontSize: '11px', color: C.sub }}>
          {t.privacyUpdatedAt(PRIVACY_UPDATED_AT)}
        </span>
      </div>

      <div className="kaeru-pad py-6">
        <h1 className="font-bold" style={{ fontSize: '21px', color: C.ink }}>
          {t.privacyTitle}
        </h1>
        <p className="mt-2" style={{ fontSize: '13px', color: C.ink, lineHeight: 1.85 }}>
          {t.privacyIntro}
        </p>

        <div className="mt-5" style={{ borderTop: `1px solid ${C.ink}` }}>
          {rows.map((r, i) => (
            <div
              key={i}
              className="flex items-center justify-between gap-3"
              style={{ padding: '12px 0', borderBottom: `1px solid ${C.line}` }}
            >
              <div className="min-w-0">
                <p style={{ fontSize: '13.5px', color: C.ink }}>{r.label}</p>
                {r.sub && (
                  <p className="mt-0.5" style={{ fontSize: '11px', color: C.sub }}>
                    {r.sub}
                  </p>
                )}
              </div>
              <Badge tone="outline">{r.badge}</Badge>
            </div>
          ))}
        </div>

        <div className="mt-6">
          <SectionLabel>{t.privacyResultsKicker}</SectionLabel>
          <p className="mt-3" style={{ fontSize: '13px', color: C.ink, lineHeight: 1.85 }}>
            {t.privacyResultOffline}
          </p>
          <p className="mt-2 font-bold" style={{ fontSize: '13px', color: C.ink, lineHeight: 1.85 }}>
            {t.privacyResultDeleteApp}
          </p>
        </div>

        <button
          onClick={onOpenDataManage}
          className="mt-6 flex w-full items-center justify-between gap-3 text-left"
          style={{ backgroundColor: C.soft, padding: '14px' }}
        >
          <div>
            <p className="font-bold" style={{ fontSize: '13px', color: C.ink }}>
              {t.privacyExportBoxTitle}
            </p>
            <p className="mt-1" style={{ fontSize: '11.5px', color: C.sub }}>
              {t.privacyExportBoxDesc}
            </p>
          </div>
          <span
            className="shrink-0 font-bold"
            style={{ fontSize: '12.5px', color: C.blueDeep }}
          >
            {t.privacyExportBoxCta} ›
          </span>
        </button>

        <p className="mt-6" style={{ fontSize: '11.5px', color: C.sub, lineHeight: 1.85 }}>
          {t.privacyLegalNote}{' '}
          <a href={`mailto:${t.aboutFeedbackEmail}`} style={{ color: C.blueDeep }}>
            {t.aboutFeedbackEmail}
          </a>
          {t.privacyLegalNote.endsWith('。') ? '' : '。'}
        </p>
      </div>
    </FullScreenSheet>
  );
}
