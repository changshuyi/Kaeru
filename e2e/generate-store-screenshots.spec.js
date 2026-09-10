import { test } from '@playwright/test';
import { seedTrip, TINY_PNG } from './helpers.js';
import fs from 'node:fs';

// 一次性產生 Google Play 上架用的正式尺寸截圖（1080×1920，9:16）。
// Play Console 手機截圖規格寫得很明確：顯示比例「必須」是 16:9 或 9:16
// （不是隨便一個接近的比例都收），且至少一邊 ≥1080px 才符合宣傳資格。
// 用 432×768 的 CSS viewport（432 還在這個 App 支援的 320–480 寬度內，
// 不會像更窄的寬度那樣把數字擠到超出螢幕）+ deviceScaleFactor 2.5，算出
// 來剛好是 1080×1920，比例精準等於 9:16。
const OUT_DIR = 'assets/play-store-screenshots';
fs.mkdirSync(OUT_DIR, { recursive: true });

const trip = { id: 't1', name: '大阪五日遊', departure: '2026-09-13T18:30', airport: 'KIX' };

const items = [
  {
    id: 'r1',
    shop: '大國藥妝 心齋橋店',
    date: '2026-09-05',
    incl: 12800,
    rate: 10,
    status: 'verified',
    refundMethod: 'registered',
    tripId: 't1',
    hasPhoto: true,
  },
  {
    id: 'r2',
    shop: 'ビックカメラ 難波店',
    date: '2026-09-06',
    incl: 45800,
    rate: 10,
    status: 'registered',
    refundMethod: 'registered',
    tripId: 't1',
    hasPhoto: true,
  },
  {
    id: 'r3',
    shop: 'UNIQLO なんば店',
    date: '2026-09-06',
    incl: 6600,
    rate: 10,
    status: 'purchased',
    refundMethod: 'unsure',
    tripId: 't1',
    hasPhoto: true,
  },
  {
    id: 'r4',
    shop: '7-Eleven 難波駅前',
    date: '2026-09-07',
    incl: 980,
    rate: 8,
    status: 'purchased',
    tripId: 't1',
    hasPhoto: false,
  },
  {
    id: 'r5',
    shop: '讚岐うどん本店',
    date: '2026-09-07',
    incl: 1200,
    rate: 8,
    status: 'purchased',
    consumed: true,
    tripId: 't1',
    hasPhoto: false,
  },
];

const photos = Object.fromEntries(
  items.filter((it) => it.hasPhoto).map((it) => [it.id, [{ src: TINY_PNG, type: 'receipt' }]]),
);

// 390×844 是這個 App 本來的設計/測試基準寬度（playwright.config.js 預設
// 視窗、e2e 全部測試都跑這個尺寸）——用它，不是隨便挑一個手機寬度，
// 避免踩到「螢幕比預期窄，數字被切掉」這種在真正窄螢幕手機上才會
// 出現的排版問題。deviceScaleFactor 3 放大到 1170×2532 輸出。
test.use({ viewport: { width: 432, height: 768 }, deviceScaleFactor: 2.5 });

test('產生 Play Store 上架截圖', async ({ page }) => {
  await seedTrip(page, { trips: [trip], activeId: 't1', items, photos });
  await page.goto('/');
  await page.waitForLoadState('networkidle');

  // 01 總覽
  await page.screenshot({ path: `${OUT_DIR}/01-home.png` });

  // 02 收據
  await page.getByRole('button', { name: '收據', exact: true }).click();
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${OUT_DIR}/02-receipts.png` });

  // 03 查驗
  await page.getByRole('button', { name: '功能' }).click();
  await page.waitForTimeout(300);
  await page.getByText('查驗', { exact: true }).click();
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${OUT_DIR}/03-check.png` });

  // 04 FQA
  await page.getByRole('button', { name: '功能' }).click();
  await page.waitForTimeout(300);
  await page.getByText('FQA', { exact: true }).click();
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${OUT_DIR}/04-faq.png` });

  // 05 設定
  await page.getByRole('button', { name: '功能' }).click();
  await page.waitForTimeout(300);
  await page.getByText('設定', { exact: true }).click();
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${OUT_DIR}/05-settings.png` });
});
