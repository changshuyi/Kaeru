import { useState, useRef } from 'react';
import { C } from '../../constants/theme.js';
import { STAGES } from '../../constants/app.js';
import { yen, netOf } from '../../lib/money.js';
import { todayStr } from '../../lib/date.js';
import { inferRefundMethod } from '../../lib/trip.js';
import { rotateImageSrc } from '../../lib/image.js';
import { useBackClose, useDirtyBackGuard } from '../../hooks/useBackNav.js';
import { usePhotoCapture } from '../../hooks/usePhotoCapture.js';
import { Field } from '../ui/Field.jsx';
import { Input } from '../ui/Input.jsx';
import { DateField } from '../ui/DateField.jsx';
import { Notice } from '../ui/Notice.jsx';
import { Toggle } from '../ui/Toggle.jsx';
import { Badge } from '../ui/Badge.jsx';
import { FullScreenSheet } from '../ui/FullScreenSheet.jsx';
import { DiscardConfirmSheet } from '../ui/DiscardConfirmSheet.jsx';
import { PhotoAttachments } from './PhotoAttachments.jsx';
import { PhotoCaptureSheets } from './PhotoCaptureSheets.jsx';
import { PhotoLightbox } from './PhotoLightbox.jsx';

export function EditSheet({
  t,
  initial,
  photos,
  onClose,
  onSave,
  photoPermissionPrimed,
  onPhotoPermissionPrimed,
}) {
  const [shop, setShop] = useState(initial?.shop || '');
  const [date, setDate] = useState(initial?.date || todayStr());
  const [incl, setIncl] = useState(initial?.incl ?? '');
  const [incl8, setIncl8] = useState(initial?.incl8 ?? '');
  const [incl10, setIncl10] = useState(initial?.incl10 ?? '');
  const [rate, setRate] = useState(initial?.rate ?? 10);
  const [taxOverride, setTaxOverride] = useState(
    initial?.taxOverride === null || initial?.taxOverride === undefined
      ? ''
      : initial.taxOverride,
  );
  // 三選一：有登記／沒有／不確定。舊資料用 inferRefundMethod() 從
  // status 反推（見該函式註解，只有停在「已登記」那一站才是可靠訊號）。
  const [refundMethod, setRefundMethod] = useState(inferRefundMethod(initial));
  const refundReg = refundMethod === 'registered';
  const [unpacked, setUnpacked] = useState(initial?.unpacked || false);
  const [consumed, setConsumed] = useState(initial?.consumed || false);
  const [note, setNote] = useState(initial?.note || '');
  const [imgs, setImgs] = useState(photos || []);

  // 返回時判斷「有沒有還沒存的變動」：跟掛載當下那份初始值比對，
  // 差一個字都算有改。新增收據（initial 沒傳）從全部預設值開始比。
  const initialSnapshotRef = useRef(
    JSON.stringify({
      shop: initial?.shop || '',
      date: initial?.date || todayStr(),
      incl: initial?.incl ?? '',
      incl8: initial?.incl8 ?? '',
      incl10: initial?.incl10 ?? '',
      rate: initial?.rate ?? 10,
      taxOverride:
        initial?.taxOverride === null || initial?.taxOverride === undefined
          ? ''
          : initial.taxOverride,
      refundMethod: inferRefundMethod(initial),
      unpacked: initial?.unpacked || false,
      consumed: initial?.consumed || false,
      note: initial?.note || '',
      imgs: photos || [],
    }),
  );
  const isDirty =
    JSON.stringify({
      shop,
      date,
      incl,
      incl8,
      incl10,
      rate,
      taxOverride,
      refundMethod,
      unpacked,
      consumed,
      note,
      imgs,
    }) !== initialSnapshotRef.current;
  const guard = useDirtyBackGuard(isDirty, onClose);
  const [lightboxIndex, setLightboxIndex] = useState(null);
  useBackClose(lightboxIndex !== null, () => setLightboxIndex(null));

  const mixed = rate === 'mixed';
  const v8 = Number(incl8) || 0;
  const v10 = Number(incl10) || 0;
  const incl8Filled = incl8 !== '' && incl8 !== null;
  const incl10Filled = incl10 !== '' && incl10 !== null;
  const net8 = netOf(v8, 8);
  const net10 = netOf(v10, 10);
  const tax8 = v8 - net8;
  const tax10 = v10 - net10;
  const singleNet = netOf(Number(incl) || 0, mixed ? 10 : rate);
  const singleAutoTax = (Number(incl) || 0) - singleNet;
  const net = mixed ? net8 + net10 : singleNet;
  const autoTax = mixed ? tax8 + tax10 : singleAutoTax;
  const effectiveIncl = mixed ? v8 + v10 : Number(incl) || 0;
  const bothFilled = incl8Filled && incl10Filled;
  const showPartialWarn = mixed && incl8Filled !== incl10Filled;
  // 稅抜合計對 5,000 円門檻的即時判定：達標用 sage，未達用 clay + 還差多少
  const metThreshold = net >= 5000;
  const thresholdText = metThreshold
    ? t.reached
    : `${t.notReached} · ${t.short} ¥${yen(5000 - net)}`;
  const thresholdColor = metThreshold ? C.sage : C.clay;

  function pickRate(r) {
    if (r !== 'mixed' && mixed) {
      // 從混合切回單一：兩格加總帶回含稅金額，兩格本身不清空
      setIncl(v8 + v10 ? String(v8 + v10) : '');
    }
    setRate(r);
  }

  const cap = usePhotoCapture({
    imgs,
    setImgs,
    onParsed: (parsed) => {
      // usePhotoCapture 現在不管有沒有讀到東西都會呼叫這個 callback
      // （讀不到也要讓呼叫端知道），完整表單不需要「不像收據」那個
      // 分支，讀不到就什麼都不做，維持原本已經填的內容。
      if (!parsed) return;
      if (parsed.shop && !shop.trim()) setShop(parsed.shop);
      if (parsed.date) setDate(parsed.date);
      if (parsed.rate === 'mixed') {
        setRate('mixed');
        if (parsed.incl8 != null) setIncl8(String(parsed.incl8));
        if (parsed.incl10 != null) setIncl10(String(parsed.incl10));
      } else if (parsed.rate != null) {
        setRate(parsed.rate);
        setIncl(String(parsed.incl));
      }
    },
    permissionPrimed: photoPermissionPrimed,
    onPrimed: onPhotoPermissionPrimed,
  });

  function save() {
    const id =
      initial?.id ||
      `r_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    let status = initial?.status || 'purchased';
    if (refundReg && STAGES.indexOf(status) < 1) status = 'registered';
    // 這裡故意只在 status 剛好停在「已登記」(=== 1) 才退回「已購買」，
    // 不是 <= 1——如果 status 已經推進到「已查驗」或「已退款」，那是
    // 真實世界發生過的事（機場真的查驗過、錢真的進來過），不能因為
    // 使用者事後把退款方式改成「沒有/不確定」就往回洗掉，跟下面
    // consumed 那條「只把已查驗退回已登記」是同一個原則：退款方式這
    // 個欄位跟查驗/退款是兩件事，反悔前者不代表後者沒發生過。
    if (!refundReg && STAGES.indexOf(status) === 1) status = 'purchased';
    // 只把「已查驗」退回「已登記」——已經退款是既成事實，事後補記
    // 「這張也在境內用掉了」不該把已經拿到手的退款記錄洗掉。
    if (consumed && status === 'verified') status = 'registered';

    let finalRate = rate;
    let finalIncl = effectiveIncl;
    if (mixed && !bothFilled) {
      // 只填一格：儲存時自動降回該單一稅率模式
      if (incl8Filled) {
        finalRate = 8;
        finalIncl = v8;
      } else if (incl10Filled) {
        finalRate = 10;
        finalIncl = v10;
      }
    }

    onSave(
      {
        id,
        shop: shop.trim(),
        date,
        incl: finalIncl,
        rate: finalRate,
        incl8: incl8Filled ? v8 : null,
        incl10: incl10Filled ? v10 : null,
        taxOverride: taxOverride === '' ? null : Number(taxOverride),
        refundMethod,
        unpacked,
        consumed,
        note: note.trim(),
        status,
        hasPhoto: !!imgs.length,
        tripId: initial?.tripId,
      },
      imgs,
    );
  }

  return (
    <>
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
        <button onClick={guard.requestClose} style={{ fontSize: '15px', color: C.sub }}>
          {t.cancel}
        </button>
        <h2 className="font-bold" style={{ fontSize: '15px' }}>
          {initial ? t.edit : t.addReceipt}
        </h2>
        <button
          onClick={save}
          // 必填只有金額（跟稅率，但稅率一定有值，見上面 rate 的
          // useState 預設）——店名跟日期一樣可以待補，完整表單不該比
          // 快路更嚴格。少了這個欄位就存不了收據，見
          // CLAUDE_CODE_DELTA_照片型別.md 第 1 節。
          disabled={!effectiveIncl}
          className="font-bold disabled:opacity-40"
          style={{ fontSize: '13px', color: C.blueDeep }}
        >
          {t.save}
        </button>
      </div>

      <div
        className="kaeru-pad py-6"
        style={{ display: 'flex', flexDirection: 'column', gap: '26px' }}
      >
        <Field label={t.shop}>
          <Input value={shop} onChange={(e) => setShop(e.target.value)} />
        </Field>

        <Field label={t.date}>
          <DateField
            value={date}
            onChange={(v) => setDate(v || todayStr())}
            t={t}
          />
        </Field>

        <Field label={t.taxRate}>
          <div className="flex gap-1.5">
            {[8, 10].map((r) => (
              <button
                key={r}
                onClick={() => pickRate(r)}
                className="font-semibold"
                style={{
                  flex: 1,
                  padding: '10px 0',
                  fontSize: '13px',
                  backgroundColor: rate === r ? C.blue : C.soft,
                  color: rate === r ? '#FFFFFF' : C.ink,
                  border: `1px solid ${rate === r ? C.blue : C.line}`,
                  borderRadius: 0,
                }}
              >
                {r}%
              </button>
            ))}
            <button
              onClick={() => pickRate('mixed')}
              className="font-semibold"
              style={{
                flex: 1.5,
                padding: '10px 0',
                fontSize: '13px',
                backgroundColor: mixed ? C.blue : C.soft,
                color: mixed ? '#FFFFFF' : C.ink,
                border: `1px solid ${mixed ? C.blue : C.line}`,
                borderRadius: 0,
              }}
            >
              {t.taxRateBoth}
            </button>
          </div>
        </Field>
        <p
          className="-mt-3"
          style={{ color: C.sub, fontSize: '11.5px', lineHeight: 1.75 }}
        >
          {t.rateHint}
        </p>

        {!mixed && (
          <Field label={t.inclAmount}>
            <input
              type="text"
              inputMode="numeric"
              value={incl === '' ? '' : `¥${yen(incl)}`}
              onChange={(e) => setIncl(e.target.value.replace(/[^\d]/g, ''))}
              className="jp-underline w-full bg-transparent font-semibold tabular-nums outline-none"
              style={{
                border: 'none',
                borderBottom: `1px solid ${C.line}`,
                color: C.ink,
                padding: '0 0 10px',
                fontSize: '20px',
              }}
            />
          </Field>
        )}

        {mixed && (
          <div
            style={{
              borderTop: `1px solid ${C.line}`,
              paddingTop: '15px',
              display: 'flex',
              flexDirection: 'column',
              gap: '15px',
            }}
          >
            {[
              {
                label: t.tax8Label,
                sub: t.tax8Sub,
                value: incl8,
                set: setIncl8,
              },
              {
                label: t.tax10Label,
                sub: t.tax10Sub,
                value: incl10,
                set: setIncl10,
              },
            ].map((row) => (
              <div
                key={row.label}
                className="flex items-end justify-between gap-3"
              >
                <span className="shrink-0">
                  <span
                    className="block font-bold"
                    style={{ fontSize: '12.5px', color: C.ink }}
                  >
                    {row.label}
                  </span>
                  <span
                    className="mt-0.5 block"
                    style={{ fontSize: '10.5px', color: C.sub }}
                  >
                    {row.sub}
                  </span>
                </span>
                <input
                  type="text"
                  inputMode="numeric"
                  placeholder={t.inclAmount}
                  value={row.value === '' ? '' : `¥${yen(row.value)}`}
                  onChange={(e) => row.set(e.target.value.replace(/[^\d]/g, ''))}
                  className="jp-underline bg-transparent text-right font-semibold tabular-nums outline-none"
                  style={{
                    flex: 1,
                    maxWidth: '168px',
                    border: 'none',
                    borderBottom: `1px solid ${C.line}`,
                    color: C.ink,
                    fontSize: '19px',
                    padding: '0 0 8px',
                  }}
                />
              </div>
            ))}
          </div>
        )}

        {!mixed ? (
          <div style={{ backgroundColor: C.soft, padding: '13px 14px' }}>
            <div className="flex items-baseline justify-between gap-3">
              <div className="min-w-0">
                <p style={{ fontSize: '11px', color: C.sub }}>
                  {t.taxAmount}（{t.taxAuto}）
                </p>
                <p
                  className="mt-1 tabular-nums"
                  style={{ fontSize: '10.5px', color: C.sub, whiteSpace: 'nowrap' }}
                >
                  {t.netTotal} ¥{yen(net)}
                  <span
                    style={{
                      marginLeft: '7px',
                      fontWeight: 600,
                      color: thresholdColor,
                    }}
                  >
                    {thresholdText}
                  </span>
                </p>
              </div>
              <input
                type="text"
                inputMode="numeric"
                placeholder={`¥${yen(autoTax)}`}
                value={taxOverride === '' ? '' : `¥${yen(taxOverride)}`}
                onChange={(e) =>
                  // 打字時就把值夾在 [0, autoTax]——理論退稅上限，不等
                  // 使用者存檔後才發現多打一個 0 被吃進總額裡。
                  setTaxOverride(() => {
                    const digits = e.target.value.replace(/[^\d]/g, '');
                    if (digits === '') return '';
                    return String(Math.min(Number(digits), autoTax));
                  })
                }
                className="bg-transparent text-right font-semibold tabular-nums outline-none"
                style={{
                  border: 'none',
                  color: C.blueDeep,
                  fontSize: '22px',
                  width: '45%',
                }}
              />
            </div>
          </div>
        ) : (
          <div style={{ backgroundColor: C.soft, padding: '14px' }}>
            <div className="flex items-baseline justify-between gap-3">
              <span style={{ fontSize: '11px', color: C.sub }}>
                {t.inclTotalLabel}　{t.autoFilledHint}
              </span>
              <span
                className="font-semibold tabular-nums"
                style={{ fontSize: '20px', color: bothFilled ? C.ink : C.sub }}
              >
                ¥{yen(effectiveIncl)}
              </span>
            </div>

            <div
              style={{
                borderTop: `1px solid ${C.line}`,
                marginTop: '10px',
                paddingTop: '10px',
              }}
            >
              <div
                className="flex items-baseline justify-between tabular-nums"
                style={{ fontSize: '11.5px', color: C.sub }}
              >
                <span>
                  {incl8Filled
                    ? `${t.tax8Label} ${t.netBare} ¥${yen(net8)}`
                    : t.tax8Label}
                </span>
                <span>
                  {incl8Filled ? `${t.taxAmount} ¥${yen(tax8)}` : t.notFilled}
                </span>
              </div>
              <div
                className="mt-1.5 flex items-baseline justify-between tabular-nums"
                style={{ fontSize: '11.5px', color: C.sub }}
              >
                <span>
                  {incl10Filled
                    ? `${t.tax10Label} ${t.netBare} ¥${yen(net10)}`
                    : t.tax10Label}
                </span>
                <span>
                  {incl10Filled ? `${t.taxAmount} ¥${yen(tax10)}` : t.notFilled}
                </span>
              </div>
            </div>

            {bothFilled && (
              <div
                style={{
                  borderTop: `1px solid ${C.line}`,
                  marginTop: '10px',
                  paddingTop: '10px',
                }}
              >
                <div className="flex items-baseline justify-between gap-3">
                  <div className="min-w-0">
                    <p style={{ fontSize: '11px', color: C.sub }}>
                      {t.taxTotalAuto}
                    </p>
                    <p
                      className="mt-1 tabular-nums"
                      style={{ fontSize: '10.5px', color: C.sub, whiteSpace: 'nowrap' }}
                    >
                      {t.netTotal} ¥{yen(net)}
                      <span
                        style={{
                          marginLeft: '7px',
                          fontWeight: 600,
                          color: thresholdColor,
                        }}
                      >
                        {thresholdText}
                      </span>
                    </p>
                  </div>
                  <input
                    type="text"
                    inputMode="numeric"
                    placeholder={`¥${yen(autoTax)}`}
                    value={taxOverride === '' ? '' : `¥${yen(taxOverride)}`}
                    onChange={(e) =>
                      setTaxOverride(e.target.value.replace(/[^\d]/g, ''))
                    }
                    className="bg-transparent text-right font-semibold tabular-nums outline-none"
                    style={{
                      border: 'none',
                      color: C.blueDeep,
                      fontSize: '22px',
                      width: '45%',
                    }}
                  />
                </div>
              </div>
            )}

            {showPartialWarn && (
              <div className="mt-3">
                <Badge tone="clay">
                  {incl8Filled ? t.tax10Label : t.tax8Label}
                  {t.notFilled}
                </Badge>
                <p
                  className="mt-2"
                  style={{ fontSize: '11.5px', color: C.sub, lineHeight: 1.75 }}
                >
                  {t.taxMixedPartialHint}
                </p>
              </div>
            )}
          </div>
        )}

        {net >= 1000000 && <Notice tone="blue">{t.warnHigh}</Notice>}

        <Field label={t.refundReg}>
          <div className="flex gap-1.5">
            {[
              ['registered', t.refundOptRegistered],
              ['no', t.refundOptNo],
              ['unsure', t.refundOptUnsure],
            ].map(([v, label]) => (
              <button
                key={v}
                onClick={() => setRefundMethod(v)}
                className="font-semibold"
                style={{
                  flex: 1,
                  padding: '10px 0',
                  fontSize: '13px',
                  backgroundColor: refundMethod === v ? C.blue : C.soft,
                  color: refundMethod === v ? '#FFFFFF' : C.ink,
                  border: `1px solid ${refundMethod === v ? C.blue : C.line}`,
                  borderRadius: 0,
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <p className="mt-2" style={{ fontSize: '11.5px', color: C.sub, lineHeight: 1.7 }}>
            {t.refundHint}
          </p>
        </Field>
        <Toggle
          checked={unpacked}
          onChange={setUnpacked}
          label={t.unpacked}
          hint={t.unpackedHint}
        />
        <Toggle
          checked={consumed}
          onChange={setConsumed}
          label={t.consumed}
          hint={t.consumedHint}
          warn
        />

        {consumed && (
          <p
            style={{
              backgroundColor: C.soft,
              borderLeft: `3px solid ${C.clay}`,
              color: C.clayInk,
              fontSize: '12.5px',
              lineHeight: 1.7,
              padding: '12px 14px',
            }}
          >
            {t.warnConsumed}
          </p>
        )}

        <PhotoAttachments
          t={t}
          photos={imgs}
          cap={cap}
          onOpenLightbox={setLightboxIndex}
        />

        <Field label={t.note}>
          <Input value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
    </FullScreenSheet>

    <PhotoCaptureSheets t={t} cap={cap} />

    {lightboxIndex !== null && (
      <PhotoLightbox
        t={t}
        shop={shop}
        date={date}
        photos={imgs}
        index={lightboxIndex}
        onIndexChange={setLightboxIndex}
        onClose={() => setLightboxIndex(null)}
        onDeletePhoto={(i) => {
          const willBeEmpty = imgs.length <= 1;
          cap.removeImg(i);
          if (willBeEmpty) setLightboxIndex(null);
          else setLightboxIndex((idx) => Math.min(idx, imgs.length - 2));
        }}
        onRotatePhoto={async (i) => {
          try {
            const rotated = await rotateImageSrc(imgs[i].src, 90);
            setImgs((prev) => prev.map((p, pi) => (pi === i ? { ...p, src: rotated } : p)));
          } catch (e) {}
        }}
      />
    )}

    {guard.discardOpen && (
      <DiscardConfirmSheet
        t={t}
        onKeepEditing={guard.keepEditing}
        onDiscard={guard.discard}
      />
    )}
    </>
  );
}
