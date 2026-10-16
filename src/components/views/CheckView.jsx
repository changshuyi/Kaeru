import { C } from '../../constants/theme.js';
import { yen } from '../../lib/money.js';
import { groupKey, isPendingInfo, isExpiredUnclaimed } from '../../lib/date.js';

export function CheckView({ t, items, groups, taxOf, onVerifyAll, onVerifyOne }) {
  const eligible = items.filter((it) => {
    const g = groups.get(groupKey(it));
    // 資料待補（店名還沒補上）跟已超過 90 天沒退到的收據，不進查驗
    // 清單——待補的連店名都打不出來，沒辦法在機場核對；已過期的已經
    // 不用查驗了。
    return (
      g &&
      g.ok &&
      !it.consumed &&
      !isPendingInfo(it) &&
      !isExpiredUnclaimed(it)
    );
  });
  const todo = eligible
    .filter((it) => it.status === 'purchased' || it.status === 'registered')
    .sort((a, b) => a.date.localeCompare(b.date));
  const done = eligible.length - todo.length;
  const total = todo.reduce((s, i) => s + taxOf(i), 0);
  // 跟首頁 stats.refundedTax 同一個修正：已查驗（verified）也算進「已退」
  // 這個數字，不然這張收據的金額會兩邊金額欄位都看不到（不在 todo，
  // 因為已經查驗過；也不在原本只算 refunded 的這個總額）。
  const refunded = eligible
    .filter((it) => it.status === 'verified' || it.status === 'refunded')
    .reduce((s, i) => s + taxOf(i), 0);
  const pct = eligible.length ? Math.round((done / eligible.length) * 100) : 0;

  return (
    <div className="pb-6">
      <section className="pt-2">
        <p
          className="text-xs"
          style={{ color: C.sub, letterSpacing: '0.16em' }}
        >
          {t.checkIntro}
        </p>

        <div className="mt-3 flex items-baseline justify-between gap-3">
          <p
            className="flex items-baseline tabular-nums"
            style={{ letterSpacing: '-0.01em' }}
          >
            <span
              className="kaeru-bignum font-semibold"
              style={{ color: C.ink, lineHeight: 1 }}
            >
              {t.checkLeft} {todo.length}
            </span>
            <span
              style={{
                color: C.sub,
                fontSize: '16px',
                fontWeight: 500,
                marginLeft: '4px',
              }}
            >
              {t.itemsUnit}
            </span>
          </p>
          <span
            className="shrink-0 font-semibold tabular-nums"
            style={{ color: C.blueDeep, fontSize: '18px' }}
          >
            ¥{yen(total)}
          </span>
        </div>

        {eligible.length > 0 && (
          <div className="mt-3 flex" style={{ height: '1px' }}>
            <div
              style={{
                width: `${pct}%`,
                backgroundColor: C.sage,
                transition: 'width 400ms ease-out',
              }}
            />
            <div style={{ width: `${100 - pct}%`, backgroundColor: C.line }} />
          </div>
        )}

        <div
          className="mt-2.5 flex items-baseline justify-between"
          style={{ fontSize: '11.5px' }}
        >
          <span style={{ color: C.sub }}>
            {t.checkDoneRatio} {done} ／ {eligible.length} {t.itemsUnit}
          </span>
          <span style={{ color: C.sub }}>
            {t.checkRefunded} ¥{yen(refunded)}
          </span>
        </div>
      </section>

      {!todo.length && (
        <p
          className="mt-8 py-10 text-center text-sm"
          style={{ color: C.sub, borderTop: `1px solid ${C.line}` }}
        >
          {t.checkEmpty}
        </p>
      )}

      <div className="mt-6">
        {todo.map((it, n) => (
          <div
            key={it.id}
            className="py-2.5"
            style={{ borderTop: `1px solid ${n === 0 ? C.ink : C.line}` }}
          >
            <div className="flex items-baseline justify-between">
              <span
                className="font-bold tabular-nums"
                style={{ color: C.blue, fontSize: '12px' }}
              >
                {String(n + 1).padStart(2, '0')}
              </span>
              <span
                className="tabular-nums"
                style={{ color: C.sub, fontSize: '12px' }}
              >
                {it.date}
              </span>
            </div>

            <p className="mt-1.5 font-bold" style={{ fontSize: '20px' }}>
              {it.shop}
            </p>

            <div className="mt-3 flex items-baseline gap-8">
              <span>
                <span
                  className="block"
                  style={{ color: C.sub, fontSize: '11px' }}
                >
                  {t.inclAmount}
                </span>
                <span
                  className="mt-0.5 block font-semibold tabular-nums"
                  style={{ fontSize: '18px' }}
                >
                  ¥{yen(it.incl)}
                </span>
              </span>
              <span>
                <span
                  className="block"
                  style={{ color: C.sub, fontSize: '11px' }}
                >
                  {t.taxAmount}
                </span>
                <span
                  className="mt-0.5 block font-semibold tabular-nums"
                  style={{ color: C.blueDeep, fontSize: '18px' }}
                >
                  ¥{yen(taxOf(it))}
                </span>
              </span>
            </div>

            {it.note && (
              <p className="mt-2" style={{ color: C.sub, fontSize: '12px' }}>
                {it.note}
              </p>
            )}

            <button
              onClick={() => onVerifyOne(it.id)}
              className="mt-3 flex w-full items-center justify-center py-2.5 font-semibold"
              style={{
                border: `1px solid ${C.blue}`,
                color: C.blueDeep,
                fontSize: '12.5px',
                borderRadius: 0,
              }}
            >
              {t.markOne}
            </button>
          </div>
        ))}
      </div>

      {todo.length > 1 && (
        <button
          onClick={onVerifyAll}
          className="mt-6 w-full py-3.5 text-sm font-semibold"
          style={{
            backgroundColor: C.blue,
            color: '#FFFFFF',
            borderRadius: 0,
            borderTop: `1px solid ${C.ink}`,
          }}
        >
          {todo.length} {t.itemsUnit}
          {t.allDone}
        </button>
      )}

      <p
        className="mt-3 text-center"
        style={{ color: C.sub, fontSize: '11px' }}
      >
        {t.checkNote}
      </p>
    </div>
  );
}
