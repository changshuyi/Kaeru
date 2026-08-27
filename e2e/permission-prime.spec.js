import { test, expect } from '@playwright/test';
import { seedTrip } from './helpers.js';

// 畫面 55：第一次要用相機/相簿前的權限說明。這裡故意不用 seedTrip
// 的預設值（photoPermissionPrimed: true），因為這個 spec 就是要測
// 「還沒看過」的狀態。

test.beforeEach(async ({ page }) => {
  await seedTrip(page, {
    trips: [{ id: 't1', name: '大阪出差', departure: '2026-11-20T10:00' }],
    activeId: 't1',
    photoPermissionPrimed: false,
  });
  await page.goto('/');
  await page.waitForLoadState('networkidle');
});

test('第一次點拍照/選圖，先看到權限說明，不是直接跳來源選單', async ({ page }) => {
  await page.getByText('新增第一張收據').click();
  await expect(page.getByText('要用相機和相簿')).toBeVisible();
  await expect(page.getByText('就這樣。沒有第三步')).toBeVisible();
  // 來源選單（拍照/從相簿選/掃描文件）這時候還不該出現
  await expect(page.getByText('從相簿選')).not.toBeVisible();
});

test('按「允許」之後才會真的跳出來源選單，且下次不會再看到說明畫面', async ({ page }) => {
  await page.getByText('新增第一張收據').click();
  await page.getByText('允許使用相機和相簿').click();
  await expect(page.getByText('從相簿選')).toBeVisible();

  // 「下次不會再看到」測的是同一次使用階段裡再開一次快速新增，不是
  // 重新整理頁面——page.goto() 重新整理會讓 addInitScript 再跑一次，
  // 把測試一開始 seed 的資料整包蓋回去，連剛剛「已經看過」這個更新
  // 都會被抹掉，不是真的在測應用程式的行為，是在測 initScript 自己
  // 的重播機制。取消這次、直接在同一個分頁裡再點一次才是要測的情境。
  await page.getByText('取消', { exact: true }).click();
  await page.getByText('新增第一張收據').click();
  await expect(page.getByText('從相簿選')).toBeVisible();
  await expect(page.getByText('要用相機和相簿')).not.toBeVisible();
});

test('按「先不要」不會強迫打開來源選單，且視為已說明過', async ({ page }) => {
  await page.getByText('新增第一張收據').click();
  await page.getByText('先不要，我自己手動輸入').click();
  await expect(page.getByText('從相簿選')).not.toBeVisible();
  // 快速新增在零張照片、沒有任何選單開著時，本來就會被判定成「使用
  // 者放棄了」自動整條退出（跟直接點來源選單的「取消」是同一套邏
  // 輯，見 QuickAddFlow 的放棄偵測效果）——「先不要」在目前的架構下
  // 沒有另一個「純手動」的快速新增畫面可以留著，退回總覽是正確、
  // 一致的結果，不是這次新加的退化。
  await expect(page.getByText('新增第一張收據')).toBeVisible();

  // 再點一次——這次應該直接看到來源選單，不會又跳一次權限說明畫面
  // （已經記住看過了，見 declinePrime）。
  await page.getByText('新增第一張收據').click();
  await expect(page.getByText('從相簿選')).toBeVisible();
  await expect(page.getByText('要用相機和相簿')).not.toBeVisible();
});
