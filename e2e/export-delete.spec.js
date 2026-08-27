import { test, expect } from '@playwright/test';
import { seedTrip, TINY_PNG } from './helpers.js';

// 資料管理／匯出／刪除三個畫面的回歸測試。這些場景在開發階段用
// Playwright 手動跑過一次確認可行，這裡把它們轉成永久的 spec，之後
// 改動這幾個畫面時能直接重跑，不用每次重新手寫一次性腳本。

function baseItems() {
  return [
    {
      id: 'r1', shop: 'ヨドバシ梅田', date: '2026-06-13', incl: 21800, rate: 10,
      incl8: null, incl10: null, taxOverride: null, refundMethod: 'registered',
      unpacked: false, consumed: false, note: '', status: 'registered', hasPhoto: true, tripId: 't1',
    },
    {
      id: 'r2', shop: '', date: '2026-06-14', incl: 0, rate: null,
      incl8: null, incl10: null, taxOverride: null, refundMethod: 'unsure',
      unpacked: false, consumed: false, note: '', status: 'purchased', hasPhoto: false, tripId: 't1',
    },
    {
      id: 'r3', shop: 'DONKI 難波店', date: '2025-01-05', incl: 5500, rate: 'mixed',
      incl8: 2200, incl10: 3300, taxOverride: null, refundMethod: 'registered',
      unpacked: false, consumed: false, note: '備註測試,逗號', status: 'refunded', hasPhoto: true, tripId: 't2',
    },
  ];
}

async function openDataManage(page) {
  await page.getByLabel('功能').click();
  // 純文字比對「設定」會同時撞到頁面標題 <h1> 跟選單裡的導覽列——只
  // 有導覽列是按鈕，用 role 篩掉標題那個。
  await page.getByRole('button', { name: /設定/ }).click();
  await page.getByText('匯出或刪除資料').click();
}

test.beforeEach(async ({ page }) => {
  await seedTrip(page, {
    items: baseItems(),
    trips: [
      { id: 't1', name: '大阪出差', departure: '2026-11-20T10:00' },
      { id: 't2', name: '舊行程', departure: '2025-01-10T10:00' },
    ],
    activeId: 't1',
    photos: {
      r1: [{ src: TINY_PNG, type: 'receipt' }],
      r3: [{ src: TINY_PNG, type: 'receipt' }, { src: TINY_PNG, type: 'item' }],
    },
  });
  await page.goto('/');
  await page.waitForLoadState('networkidle');
});

test('資料管理頁顯示正確的收據跟照片統計', async ({ page }) => {
  await openDataManage(page);
  await expect(page.getByText('3 張收據')).toBeVisible();
  await expect(page.getByText(/照片 3 張/)).toBeVisible();
  await expect(page.getByText(/已結束的行程/)).toBeVisible();
});

test('CSV 匯出：待補金額留空不是 0、混合稅率標成 8%+10%、逗號欄位正確加引號', async ({ page }) => {
  await openDataManage(page);
  await page.getByText('全部行程').click();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByText('匯出 CSV').click(),
  ]);
  const fs = await import('fs');
  const csvPath = await download.path();
  const text = fs.readFileSync(csvPath, 'utf8').replace(/^﻿/, '');
  const rows = text.trim().split('\r\n');

  expect(rows).toHaveLength(4); // header + 3 筆
  // r2（店名/金額都待補）那一行，含稅金額跟稅率兩格都要是空的
  const pendingRow = rows.find((r) => r.includes('2026-06-14'));
  const cols = pendingRow.split(',');
  expect(cols[3]).toBe('');
  expect(cols[4]).toBe('');
  expect(text).toContain('8%+10%');
  expect(text).toContain('"備註測試,逗號"');
});

test('ZIP 匯出：產出合法的 ZIP 檔', async ({ page }) => {
  await openDataManage(page);
  await page.getByText('全部行程').click();
  await page.getByText('ZIP 含照片').click();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByText('匯出 ZIP').click(),
  ]);
  const fs = await import('fs');
  const buf = fs.readFileSync(await download.path());
  expect(buf[0]).toBe(0x50); // 'P'
  expect(buf[1]).toBe(0x4b); // 'K'
});

test('刪除「已結束的行程」：只刪掉過期行程的收據，其他行程不受影響', async ({ page }) => {
  await openDataManage(page);
  await page.getByText(/已結束的行程/).click();
  await expect(page.getByText('還沒匯出過')).toBeVisible();
  await page.getByRole('button', { name: '刪除', exact: true }).click();
  await expect(page.getByText('舊行程')).not.toBeVisible();
});

test('先匯出再刪除：刪除確認頁記得上次匯出時間', async ({ page }) => {
  await openDataManage(page);
  await page.getByText('全部行程').click();
  await Promise.all([page.waitForEvent('download'), page.getByText('匯出 CSV').click()]);
  await page.getByText(/已結束的行程/).click();
  await expect(page.getByText(/上次匯出/)).toBeVisible();
});

test('只刪照片：金額紀錄留著，照片清空', async ({ page }) => {
  await openDataManage(page);
  await page.getByText(/只刪照片/).click();
  await page.getByRole('button', { name: '刪除照片', exact: true }).click();
  // 「只刪照片」是一般 BottomSheet，關掉之後回到的還是同一個仍開著的
  // DataManageSheet（那層本身沒有被關掉），不用也不能再開一次選單
  // ——這時候頁面上疊著兩層 FullScreenSheet 的入場動畫，直接在原地
  // 檢查文字就好。
  await expect(page.getByText('3 張收據')).toBeVisible();
  await expect(page.getByText(/照片 0 張/)).toBeVisible();
});

test('刪除全部資料：行程跟收據一起清空，回到空狀態', async ({ page }) => {
  await openDataManage(page);
  await page.getByText('全部資料', { exact: true }).click();
  await page.getByRole('button', { name: '刪除', exact: true }).click();
  // 這裡跟「只刪照片」不同：onConfirmDelete 會把 DataManageSheet 也
  // 一起關掉（見 App 元件那段 onConfirmDelete），需要重新從設定頁
  // 點進去才能看到更新後的統計。
  await openDataManage(page);
  await expect(page.getByText('0 張收據', { exact: true })).toBeVisible();
});
