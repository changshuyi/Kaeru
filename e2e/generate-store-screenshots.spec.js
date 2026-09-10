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

  // 06 新增收據（拍照/選圖來源選單）——每段流程重新整理頁面再操作，
  // 不共用同一個瀏覽階段：這個 App 的關閉/返回是自己接管 history 的，
  // 跟 Playwright 的 goBack() 混用會兜不起來（踩過一次：detail 跟
  // scenario 兩張截圖內容變成一樣）。
  await page.reload();
  await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: '新增收據' }).click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT_DIR}/06-quick-add.png` });

  // 07 收據詳情
  await page.reload();
  await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: '收據', exact: true }).click();
  await page.waitForTimeout(200);
  // 店名是分組標題文字，不是可點區域——真正會開詳情頁的是卡片本身，
  // 點卡片裡的金額文字才對。
  await page.getByText('¥45,800', { exact: true }).click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT_DIR}/07-detail.png` });

  // 08 情境模擬
  await page.reload();
  await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: '功能' }).click();
  await page.waitForTimeout(300);
  await page.getByText('FQA', { exact: true }).click();
  await page.waitForTimeout(200);
  await page.getByText('開始這趟旅程').click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT_DIR}/08-scenario.png` });
});

// 平板截圖：跟手機那組共用同一份種子資料，但用真正的平板寬度（不是把
// 手機截圖硬拉大）——這個 App 過了 480px 就鎖寬置中、兩側留白，這組
// 截圖故意用比 480 寬的視窗，如實呈現「在平板上長怎樣」，不是假裝成
// 手機比例。7 吋、10 吋各自算好 viewport + deviceScaleFactor，讓輸出
// 剛好精準等於 9:16，同時滿足 Play Console 對應的邊長門檻
// （7 吋：320–3840px；10 吋：1,080–7,680px，兩邊都要達到）。
const TABLET_SIZES = [
  { label: '7 吋', dir: 'assets/play-store-screenshots/tablet-7in', width: 540, height: 960, scale: 2 }, // -> 1080x1920
  { label: '10 吋', dir: 'assets/play-store-screenshots/tablet-10in', width: 810, height: 1440, scale: 2 }, // -> 1620x2880
];

for (const size of TABLET_SIZES) {
  test(`產生 ${size.label} 平板截圖`, async ({ browser }) => {
    fs.mkdirSync(size.dir, { recursive: true });
    const page = await browser.newPage({
      viewport: { width: size.width, height: size.height },
      deviceScaleFactor: size.scale,
    });
    await seedTrip(page, { trips: [trip], activeId: 't1', items, photos });
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: `${size.dir}/01-home.png` });

    await page.getByRole('button', { name: '收據', exact: true }).click();
    await page.waitForTimeout(200);
    await page.screenshot({ path: `${size.dir}/02-receipts.png` });
    await page.close();
  });
}
