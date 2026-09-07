import { useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { C } from '../../constants/theme.js';
import { QA, TIPS } from '../../i18n/content.js';
import { SectionLabel } from '../ui/SectionLabel.jsx';
import { FaqRow } from './FaqRow.jsx';

export function FaqView({ t, lang, onStart }) {
  // 每一區各自最多展開一題，互不影響——不是整頁只能開一題。預設值
  // 是每區第一題，加了「出境時」的 VJW 兩題之後，「消費稅是幾 %？」
  // 排到 buy 區第二題，不再是預設展開的那一題。
  const [open, setOpen] = useState({ buy: 'buy-0', exit: 'exit-0', refund: 'refund-0' });
  const sections = ['buy', 'exit', 'refund'];

  return (
    <div className="space-y-12 pb-6 pt-2">
      {sections.map((sec) => (
        <section key={sec}>
          <SectionLabel>{t.faqSection[sec]}</SectionLabel>
          <div className="mt-3">
            {QA.filter((x) => x.sec === sec).map((item, i) => {
              const key = `${sec}-${i}`;
              return (
                <FaqRow
                  key={key}
                  item={item}
                  lang={lang}
                  open={open[sec] === key}
                  onToggle={() =>
                    setOpen((prev) => ({
                      ...prev,
                      [sec]: prev[sec] === key ? null : key,
                    }))
                  }
                />
              );
            })}
          </div>
        </section>
      ))}

      <section>
        <SectionLabel>{t.tipsTitle}</SectionLabel>
        <ol
          className="mt-6"
          style={{ display: 'flex', flexDirection: 'column', gap: '22px' }}
        >
          {TIPS.map((tip, i) => (
            <li key={i} className="flex gap-5">
              <span
                className="shrink-0 font-bold tabular-nums"
                style={{ color: C.blue, opacity: 0.7, fontSize: '12px' }}
              >
                {String(i + 1).padStart(2, '0')}
              </span>
              <p style={{ fontSize: '13px', lineHeight: 2 }}>{tip[lang]}</p>
            </li>
          ))}
        </ol>
      </section>

      <button
        onClick={onStart}
        className="block w-full text-left"
        style={{ backgroundColor: C.soft, padding: '22px', borderRadius: 0 }}
      >
        <p className="font-bold" style={{ fontSize: '18px', lineHeight: 1.4 }}>
          {t.sim}
        </p>
        <p className="mt-2" style={{ color: C.sub, fontSize: '12.5px' }}>
          {t.simSub}
        </p>
        <span
          className="mt-5 inline-flex items-center gap-1 font-semibold"
          style={{ color: C.blueDeep, fontSize: '13px' }}
        >
          {t.startSim}
          <ChevronRight size={15} />
        </span>
      </button>

      <p className="text-center text-xs" style={{ color: C.sub }}>
        {t.source}
      </p>
    </div>
  );
}
