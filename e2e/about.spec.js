import { test, expect } from '@playwright/test';
import { seedTrip } from './helpers.js';

// 「關於 Kaeru」／隱私說明兩個畫面的回歸測試——這兩頁沒有複雜的
// 業務邏輯，測試重點是「連結真的可以點得到」，不是內容本身（內容
// 是設計稿逐字給的文案，不會壞在程式邏輯上）。

test.beforeEach(async ({ page }) => {
  await seedTrip(page, {
    trips: [{ id: 't1', name: '大阪出差', departure: '2026-11-20T10:00' }],
    activeId: 't1',
  });
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await page.getByLabel('功能').click();
  await page.getByRole('button', { name: /設定/ }).click();
});

test('關於 Kaeru：三個 kaeru 對照表都顯示，能連到隱私說明', async ({ page }) => {
  await page.getByText('關於 Kaeru').click();
  await expect(page.getByText('帰る')).toBeVisible();
  await expect(page.getByText('換える')).toBeVisible();
  await expect(page.getByText('蛙', { exact: true })).toBeVisible();
  await expect(page.getByText('不代辦退稅、不碰你的錢')).toBeVisible();

  await page.getByText('隱私說明').click();
  await expect(page.getByText('你的資料在哪裡')).toBeVisible();
});

test('隱私說明：能從「匯出或刪除全部資料」直接跳到資料管理頁', async ({ page }) => {
  await page.getByText('關於 Kaeru').click();
  await page.getByText('隱私說明').click();
  await page.getByText('匯出或刪除全部資料').click();
  await expect(page.getByRole('heading', { name: '匯出或刪除資料' })).toBeVisible();
});
