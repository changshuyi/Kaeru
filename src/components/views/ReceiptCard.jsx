import { Camera as CameraIcon } from 'lucide-react';
import { C } from '../../constants/theme.js';
import { STAGES } from '../../constants/app.js';
import { yen, twd, netOfItem } from '../../lib/money.js';
import { daysLeft } from '../../lib/date.js';
import { Badge } from '../ui/Badge.jsx';
import { Ticket } from '../ui/Ticket.jsx';

export function ReceiptCard({
  it,
  t,
  taxOf,
  settings,
  groupOk,
  separator,
  itemPhotoCount,
  hasDeparture,
  onEditTrip,
  onClick,
}) {
  const d = daysLeft(it.date);
  const tax = taxOf(it);
  const consumedDead = !!it.consumed;
  // 已超過 90 天期限、還沒真的退到錢的收據，跟「已在境內消費」共用同一套
  // 失效樣式（卡底色、金額劃線）——但這是「來不及」不是「用掉了」，徽章
  // 跟說明文字要分開寫，進度軌跡也保留原本走到哪一步，不像消費那樣整個
  // 收縮成卡在第一步。
  // 跟 isExpiredUnclaimed() 同一個判斷：已查驗（verified）也要當成錢
  // 已經到手，不然一張查驗過但還沒手動標「已退款」的收據，一旦超過
  // 90 天就會被畫成失效樣式,跟首頁 stats.refundedTax 早就把它算進
  // 「已退回」的邏輯自相矛盾。
  const expiredDead =
    !consumedDead &&
    it.status !== 'refunded' &&
    it.status !== 'verified' &&
    d !== null &&
    d < 0;
  const dead = consumedDead || expiredDead;
  const warn = !dead && !groupOk;
  const stageIdx = STAGES.indexOf(it.status);
  const deadlineText =
    d === null ? null : d < 0 ? t.expired : `${t.warnDeadline} ${d} ${t.days}`;
  // d &lt; 0（已經過期）現在不再保證 dead 是 true——已查驗/已退款的收據
  // 就算超過 90 天也不算「來不及」（expiredDead 已經排除這兩種狀態），
  // 但那種情況下「期限剩 N 天」倒數徽章一樣沒意義，不能顯示負數天數，
  // 要另外擋掉，不能只靠 !dead。這裡還要加上 hasDeparture——沒有回程
  // 時間，「還剩 N 天」這個數字對使用者沒有實際意義（見
  // CLAUDE_CODE_DELTA_未設定回程時間.md），寧可老實顯示「期限待定」。
  const showDeadlineBadge = !dead && hasDeparture && d !== null && d >= 0 && d <= 30;
  // 沒有回程時間、這張也還沒失效（expiredDead 是拿沒有回程時間也算得
  // 出來的原始 d 判斷，跟這裡是不同層次的東西）——不管達不達標門檻，
  // 都要老實掛上「期限待定」，不能因為 warn 分支已經佔掉這個位置，
  // 就讓使用者以為這張沒有期限問題。
  const showDeadlinePending = !dead && !hasDeparture && d !== null;
  const showPendingBadge = !dead && !warn && stageIdx < 2;
  const tone = warn ? C.clay : expiredDead ? C.sub : C.blue;

  return (
    <Ticket
      tone={dead ? 'dead' : 'normal'}
      onClick={onClick}
      separator={separator}
    >
      <div className="flex items-baseline justify-between gap-3">
        <p
          className="font-semibold tabular-nums"
          style={{
            fontSize: '18px',
            color: dead ? C.sub : C.ink,
            textDecoration: dead ? 'line-through' : 'none',
            textDecorationColor: dead ? C.clay : 'currentColor',
          }}
        >
          ¥{yen(it.incl)}
        </p>
        <p className="tabular-nums" style={{ color: C.sub, fontSize: '11px' }}>
          {t.taxAmount} ¥{yen(tax)}
          {dead ? ` ${t.lostTax}` : ` ≈ NT$${twd(tax * settings.rate)}`}
        </p>
      </div>

      {/* 四段進度：7×7px 方點，中間連線撐滿。在境內消費時第一點填色、其餘
          變空心（整張收據作廢，走到哪一步不重要）；過期未退保留真正走到
          哪一步，只是用比較淡的顏色，表示這個進度已經沒有意義了。 */}
      <div className="mt-2.5 flex items-center">
        {STAGES.map((sname, n) => (
          <div key={sname} className="flex flex-1 items-center last:flex-none">
            <div
              className="shrink-0"
              style={
                consumedDead
                  ? n === 0
                    ? { width: '7px', height: '7px', backgroundColor: C.clay }
                    : {
                        width: '7px',
                        height: '7px',
                        border: `1px solid ${C.line}`,
                        backgroundColor: '#FFFFFF',
                      }
                  : {
                      width: '7px',
                      height: '7px',
                      backgroundColor: n <= stageIdx ? tone : C.line,
                    }
              }
            />
            {n < STAGES.length - 1 && (
              <div
                style={{
                  height: '1px',
                  flex: 1,
                  backgroundColor:
                    !consumedDead && n < stageIdx ? tone : C.line,
                }}
              />
            )}
          </div>
        ))}
      </div>

      {consumedDead ? (
        <p
          className="mt-1.5"
          style={{ color: C.clayInk, fontSize: '9.5px', fontWeight: 600 }}
        >
          {t.stalled}
        </p>
      ) : (
        <div className="mt-1.5 flex justify-between" style={{ fontSize: '9.5px' }}>
          {STAGES.map((sname, n) =>
            n === stageIdx ? (
              <span
                key={sname}
                className="font-semibold"
                style={{ color: expiredDead ? C.clayInk : warn ? C.clayInk : C.blueDeep }}
              >
                {expiredDead
                  ? t.stageShort[sname]
                  : warn
                    ? `${t.stuckAt}${t.stageShort[sname]}`
                    : t.stageShort[sname]}
              </span>
            ) : (
              <span key={sname} style={{ color: C.sub }}>
                {t.stageShort[sname]}
              </span>
            )
          )}
        </div>
      )}

      <div className="mt-2.5 flex flex-wrap gap-1.5">
        {consumedDead ? (
          <>
            <Badge tone="clay">{t.consumedShort}</Badge>
            <Badge tone="clay">{t.dead}</Badge>
            {it.unpacked && <Badge tone="outline">{t.unpackedShort}</Badge>}
          </>
        ) : expiredDead ? (
          <>
            <Badge tone="clay">{t.expiredBadge}</Badge>
            {it.unpacked && <Badge tone="outline">{t.unpackedShort}</Badge>}
            {it.refundMethod === 'registered' && (
              <Badge tone="outline">{t.refundReg}</Badge>
            )}
          </>
        ) : (
          <>
            {warn ? (
              <>
                <Badge tone="clay">{t.notReached}</Badge>
                <Badge tone="outline">{t.refillTip}</Badge>
              </>
            ) : (
              <>
                {showPendingBadge && <Badge tone="blue">{t.pendingCheck}</Badge>}
                {showDeadlineBadge && <Badge tone="clay">{deadlineText}</Badge>}
                {netOfItem(it) >= 1000000 && <Badge tone="blue">100万円+</Badge>}
              </>
            )}
            {showDeadlinePending && (
              // 線框＝待補，不是警示，故意不用 clay 填色——這張收據本身
              // 沒問題，只是還算不出期限。點了直接跳去填回程時間，不能
              // 冒泡到卡片本身的 onClick（那個是開詳情頁，兩個是不同的
              // 動作）。
              <span
                onClick={(e) => {
                  e.stopPropagation();
                  onEditTrip && onEditTrip();
                }}
                style={{ cursor: 'pointer' }}
              >
                <Badge tone="outline">{t.deadlinePendingBadge}</Badge>
              </span>
            )}
            {it.unpacked && <Badge tone="outline">{t.unpackedShort}</Badge>}
            {it.refundMethod === 'registered' && (
              <Badge tone="outline">{t.refundReg}</Badge>
            )}
          </>
        )}
      </div>

      {consumedDead && (
        <p
          className="mt-2.5"
          style={{ color: C.clayInk, fontSize: '11.5px', lineHeight: 1.8 }}
        >
          {t.deadCardNote}
        </p>
      )}
      {expiredDead && (
        <p
          className="mt-2.5"
          style={{ color: C.clayInk, fontSize: '11px' }}
        >
          {t.expired}
        </p>
      )}

      {/* 物品照片只是備忘，不是判讀資訊——不進卡片主體、不佔任何欄位
          位置，金額/達標/期限這些真正要看的東西一格都不讓。浮在右下角
          純粹是「這張收據還附了幾張物品照片」的提示，跟旁邊 tap 進
          詳情頁是同一個動作，不需要另外接一個獨立的點擊目標。 */}
      {itemPhotoCount > 0 && (
        <span
          className="absolute flex items-center gap-1"
          style={{ right: '14px', bottom: '14px', color: C.sub, fontSize: '11px' }}
        >
          <CameraIcon size={13} strokeWidth={1.6} />
          <span className="tabular-nums">{itemPhotoCount}</span>
        </span>
      )}
    </Ticket>
  );
}
