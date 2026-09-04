import { useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { C } from '../../constants/theme.js';
import { RULES, SIM } from '../../i18n/content.js';
import { yen } from '../../lib/money.js';
import { useCountUp } from '../../hooks/useCountUp.js';
import { Badge } from '../ui/Badge.jsx';
import { SectionLabel } from '../ui/SectionLabel.jsx';

export function Scenario({ t, lang, onExit }) {
  const [i, setI] = useState(-1);
  const [picked, setPicked] = useState(null);
  const [log, setLog] = useState([]);

  const total = log.reduce((s, x) => s + x.lose, 0);
  const lost = Math.min(total, SIM.max);
  const got = SIM.max - lost;
  const shown = useCountUp(got);

  const stepCount = i === -1 ? null : Math.min(i + 1, SIM.steps.length);
  const navBar = (
    <div
      className="flex items-center justify-between pb-3"
      style={{ borderBottom: `1px solid ${C.line}` }}
    >
      <button
        onClick={onExit}
        className="flex items-center gap-1"
        style={{ color: C.sub, fontSize: '13px' }}
      >
        <ChevronLeft size={15} /> {t.backToFaq}
      </button>
      {stepCount && (
        <span
          className="font-semibold tabular-nums"
          style={{ color: C.ink, fontSize: '13px' }}
        >
          {stepCount}
          {t.of}
          {SIM.steps.length}
        </span>
      )}
    </div>
  );

  const keyframes = `@keyframes jpFade{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}`;

  if (i === -1) {
    return (
      <div className="space-y-8 pb-6 pt-2">
        {navBar}
        <div>
          <h2
            className="font-bold"
            style={{ fontSize: '22px', lineHeight: 1.4 }}
          >
            {t.sim}
          </h2>
          <p
            className="mt-4"
            style={{ color: C.sub, fontSize: '14px', lineHeight: 2 }}
          >
            {SIM.intro[lang]}
          </p>
        </div>

        <div
          style={{ backgroundColor: C.soft, padding: '22px', borderRadius: 0 }}
        >
          <p style={{ color: C.sub, fontSize: '12.5px' }}>{t.simMax}</p>
          <p
            className="mt-1 font-bold tabular-nums"
            style={{ color: C.blueDeep, fontSize: '28px' }}
          >
            ¥{yen(SIM.max)}
          </p>
          <ul
            className="mt-4"
            style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}
          >
            {SIM.wallet[lang].map((w, n) => (
              <li
                key={n}
                className="flex items-baseline gap-2.5"
                style={{ fontSize: '13px' }}
              >
                <span
                  className="shrink-0"
                  style={{
                    width: '4px',
                    height: '4px',
                    backgroundColor: C.blue,
                  }}
                />
                <span style={{ lineHeight: 1.6 }}>{w}</span>
              </li>
            ))}
          </ul>
        </div>

        <button
          onClick={() => setI(0)}
          className="w-full py-3.5 text-sm font-semibold"
          style={{ backgroundColor: C.blue, color: '#FFFFFF', borderRadius: 0 }}
        >
          {t.startSim}
        </button>
      </div>
    );
  }

  if (i >= SIM.steps.length) {
    const misses = log.filter((x) => x.lose > 0 || x.penalty);
    const successCount = SIM.steps.length - misses.length;
    const pct = Math.round((got / SIM.max) * 100);
    // #14 修正：每一題卡片上顯示的「損失 ¥X」原本是各題各自的原始
    // 金額；題目之間如果對同一件虛擬商品有矛盾判定，逐題金額加總會
    // 超過上面「總共損失」（已經用 Math.min 封頂）的數字，畫面上兩個
    // 數字會自己矛盾。改成顯示「算進這一題之後，封頂總額往上增加了
    // 多少」，逐題累加起來保證跟封頂後的總額一致。
    let runningRaw = 0;
    const missesDisplay = misses.map((m) => {
      const before = Math.min(runningRaw, SIM.max);
      runningRaw += m.lose;
      const after = Math.min(runningRaw, SIM.max);
      return { ...m, displayLose: after - before };
    });
    return (
      <div className="space-y-10 pb-6 pt-2">
        <style>{keyframes}</style>
        {navBar}

        <div>
          <p
            className="font-bold"
            style={{
              color: C.sub,
              fontSize: '10.5px',
              letterSpacing: '0.24em',
            }}
          >
            {t.simDone}
          </p>
          <div className="mt-3 flex items-end justify-between gap-3">
            <div>
              <p style={{ color: C.sub, fontSize: '11px' }}>{t.simGot}</p>
              <p
                className="font-bold tabular-nums"
                style={{ color: C.blueDeep, fontSize: '48px', lineHeight: 1 }}
              >
                ¥{yen(shown)}
              </p>
            </div>
            <div className="text-right">
              <p style={{ color: C.sub, fontSize: '11px' }}>{t.simMax}</p>
              <p
                className="font-semibold tabular-nums"
                style={{ color: C.ink, fontSize: '17px' }}
              >
                ¥{yen(SIM.max)}
              </p>
            </div>
          </div>

          <div className="mt-4 flex" style={{ height: '1px' }}>
            <div
              style={{
                width: `${pct}%`,
                backgroundColor: C.sage,
                transition: 'width 600ms ease-out',
              }}
            />
            <div style={{ width: `${100 - pct}%`, backgroundColor: C.clay }} />
          </div>

          <div
            className="mt-2.5 flex items-baseline justify-between"
            style={{ fontSize: '11.5px' }}
          >
            <span style={{ color: C.sub }}>
              {t.simSuccess} {successCount} ／ {SIM.steps.length}{' '}
              {t.unitDecisions}
            </span>
            {lost > 0 && (
              <span className="font-semibold" style={{ color: C.clayInk }}>
                {t.simLost} ¥{yen(lost)}
              </span>
            )}
          </div>
        </div>

        {misses.length === 0 ? (
          <p
            style={{
              color: C.sub,
              fontSize: '14px',
              lineHeight: 1.8,
              borderTop: `1px solid ${C.ink}`,
              paddingTop: '16px',
            }}
          >
            {t.simPerfect}
          </p>
        ) : (
          <section style={{ borderTop: `1px solid ${C.ink}`, paddingTop: '16px' }}>
            <SectionLabel>{t.simWhy}</SectionLabel>
            <div className="mt-3">
              {missesDisplay.map((m, n) => (
                <div
                  key={n}
                  className="py-5"
                  style={{ borderTop: `1px solid ${C.line}` }}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span
                      className="font-bold tabular-nums"
                      style={{ color: C.blue, fontSize: '12px' }}
                    >
                      {t.simStep} {String(m.step + 1).padStart(2, '0')}
                    </span>
                    {m.displayLose > 0 && (
                      <Badge tone="clay">
                        {t.simLost} ¥{yen(m.displayLose)}
                      </Badge>
                    )}
                  </div>
                  <p className="mt-2 font-bold" style={{ fontSize: '15px' }}>
                    {m.label[lang]}
                  </p>
                  <p
                    className="mt-1.5"
                    style={{ fontSize: '12.5px', lineHeight: 1.95 }}
                  >
                    {(m.penalty || m.fb)[lang]}
                  </p>
                </div>
              ))}
            </div>
          </section>
        )}

        <section style={{ borderTop: `1px solid ${C.line}`, paddingTop: '16px' }}>
          <SectionLabel>{t.rulesTitle}</SectionLabel>
          <ol className="mt-4 space-y-5">
            {RULES[lang].slice(0, 3).map((r, n) => (
              <li key={n} className="flex gap-4">
                <span
                  className="shrink-0 font-bold tabular-nums"
                  style={{ color: C.blue, fontSize: '12px' }}
                >
                  {String(n + 1).padStart(2, '0')}
                </span>
                <p style={{ fontSize: '14px', lineHeight: 1.75 }}>{r}</p>
              </li>
            ))}
          </ol>
        </section>

        <div className="flex gap-3">
          <button
            onClick={() => {
              setI(-1);
              setPicked(null);
              setLog([]);
            }}
            className="flex-1 py-3.5 text-sm font-semibold"
            style={{
              border: `1px solid ${C.blue}`,
              color: C.blueDeep,
              borderRadius: 0,
            }}
          >
            {t.again}
          </button>
          <button
            onClick={onExit}
            className="flex-1 py-3.5 text-sm font-semibold"
            style={{
              backgroundColor: C.blue,
              color: '#FFFFFF',
              borderRadius: 0,
            }}
          >
            {t.backToFaq}
          </button>
        </div>
      </div>
    );
  }

  const step = SIM.steps[i];
  const canContinue = picked !== null;

  return (
    <div className="pb-6 pt-2">
      <style>{keyframes}</style>
      {navBar}

      {/* 九段進度 */}
      <div className="mt-5 flex" style={{ gap: '3px' }}>
        {SIM.steps.map((_, n) => (
          <div
            key={n}
            style={{
              height: '3px',
              flex: 1,
              backgroundColor: n <= i ? C.blue : C.line,
            }}
          />
        ))}
      </div>

      <div className="mt-6 flex items-baseline justify-between gap-3">
        <span
          className="font-bold"
          style={{ color: C.blue, fontSize: '10.5px', letterSpacing: '0.2em' }}
        >
          {step.where[lang]}
        </span>
        <span
          className="font-semibold tabular-nums"
          style={{ color: C.blueDeep, fontSize: '17px' }}
        >
          {t.simGot} ¥{yen(shown)}
        </span>
      </div>

      <p className="mt-4" style={{ fontSize: '14px', lineHeight: 2 }}>
        {step.scene[lang]}
      </p>
      <p className="mt-2 font-bold" style={{ fontSize: '19px' }}>
        {step.q[lang]}
      </p>

      {/* 選項 */}
      <div
        className="mt-5"
        style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}
      >
        {step.opts.map((o, n) => {
          const isChosen = picked === n;
          if (!isChosen) {
            return (
              <button
                key={n}
                disabled={picked !== null}
                onClick={() => {
                  setPicked(n);
                  setLog((l) => [
                    ...l,
                    {
                      step: i,
                      lose: o.lose || 0,
                      fb: o.fb,
                      penalty: o.penalty,
                      label: o.label,
                    },
                  ]);
                }}
                className="w-full text-left"
                style={{
                  border: `1px solid ${C.line}`,
                  color: C.sub,
                  fontSize: '14px',
                  lineHeight: 1.6,
                  padding: '14px 16px',
                  opacity: picked !== null ? 0.5 : 1,
                }}
              >
                {o.label[lang]}
              </button>
            );
          }
          const good = !!o.best;
          return (
            <div
              key={n}
              style={{
                border: `1px solid ${good ? C.sage : C.clay}`,
                backgroundColor: C.soft,
                padding: '14px 16px',
                animation: 'jpFade 220ms ease-out',
              }}
            >
              <div className="flex items-start justify-between gap-3">
                <span
                  className="font-bold"
                  style={{ fontSize: '14px', lineHeight: 1.6 }}
                >
                  {o.label[lang]}
                </span>
                <Badge tone={good ? 'sage' : 'clay'}>
                  {good ? t.simGood : t.simBad}
                </Badge>
              </div>
              <p
                className="mt-2.5"
                style={{ fontSize: '12.5px', lineHeight: 1.95 }}
              >
                {o.fb[lang]}
              </p>
              {o.lose > 0 && (
                <span className="mt-2 inline-block">
                  <Badge tone="clay">
                    {t.simLost} ¥{yen(o.lose)}
                  </Badge>
                </span>
              )}
            </div>
          );
        })}
      </div>

      <div
        className="mt-6 flex items-center justify-between gap-3 pt-4"
        style={{ borderTop: `1px solid ${C.line}` }}
      >
        <span style={{ color: C.sub, fontSize: '11px' }}>
          {t.simMax} ¥{yen(SIM.max)}
        </span>
        <button
          onClick={() => {
            setI(i + 1);
            setPicked(null);
          }}
          disabled={!canContinue}
          className="flex items-center gap-1 font-semibold disabled:opacity-40"
          style={{
            backgroundColor: C.blue,
            color: '#FFFFFF',
            fontSize: '13px',
            padding: '10px 20px',
            borderRadius: 0,
          }}
        >
          {t.next} <ChevronRight size={14} />
        </button>
      </div>
    </div>
  );
}
