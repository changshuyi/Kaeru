import { test, expect } from '@playwright/test';
import { seedTrip } from './helpers.js';

// 這個 spec 蓋的是這個 session 抓到過的兩個真實 bug 的回歸測試，不是
// 憑空寫的理想案例：
// 1. amountReady（金額+稅率備齊）曾經被拿來決定要不要切成摘要卡，
//    打第一個數字（稅率已選）畫面就整個換掉，輸入框消失、後面數字
//    打不進去——修法是改用 amountFound（純粹 OCR 有沒有讀到）。
// 2. 「沒讀到金額」畫面的稅率選擇列補上之前，「稅率待選」標籤指向
//    一個不存在的欄位。

test.beforeEach(async ({ page }) => {
  await seedTrip(page, {
    trips: [{ id: 't1', name: '大阪出差', departure: '2026-11-20T10:00' }],
    activeId: 't1',
  });
  await page.goto('/');
  await page.waitForLoadState('networkidle');
});

test('沒讀到金額時可以手動輸入完整金額，畫面不會在打字中途切走', async ({ page }) => {
  await page.getByText('新增第一張收據').click();
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.getByText('從相簿選').click(),
  ]);
  await chooser.setFiles({
    name: 'blank.png',
    mimeType: 'image/png',
    // 沒有任何文字內容的圖——OCR 在瀏覽器環境本來就一定會失敗
    // （ReceiptScanner 是原生 plugin，網頁上永遠 reject），確定性地
    // 落在「讀不到，手動補」這條路，剛好是這個測試要驗證的畫面。
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      'base64',
    ),
  });
  await page.getByText('使用這張').click();

  const input = page.locator('input.quick-add-incl-input');
  await expect(input).toBeVisible();

  // 逐字打「5000」——如果 amountReady 那個舊 bug 重現，選好稅率之後
  // 打第一個字「5」畫面就會整個切成摘要卡，輸入框消失，後面的
  // "000" 根本沒有地方可以打。
  await page.getByRole('button', { name: '10%', exact: true }).click();
  await input.pressSequentially('5000');
  await expect(input).toBeVisible();
  await expect(input).toHaveValue('5000');
});

test('稅率選擇列存在，三顆按鈕都能點掉「稅率待選」標籤', async ({ page }) => {
  await page.getByText('新增第一張收據').click();
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.getByText('從相簿選').click(),
  ]);
  await chooser.setFiles({
    name: 'blank.png',
    mimeType: 'image/png',
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      'base64',
    ),
  });
  await page.getByText('使用這張').click();

  await expect(page.getByText('稅率待選')).toBeVisible();
  await expect(page.getByRole('button', { name: '8%', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '10%', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '兩種都有', exact: true })).toBeVisible();

  await page.getByRole('button', { name: '兩種都有', exact: true }).click();
  await expect(page.getByText('稅率待選')).not.toBeVisible();
});

test('退款方式沒選時存不了，選了就能存', async ({ page }) => {
  await page.getByText('新增第一張收據').click();
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.getByText('從相簿選').click(),
  ]);
  await chooser.setFiles({
    name: 'blank.png',
    mimeType: 'image/png',
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      'base64',
    ),
  });
  await page.getByText('使用這張').click();

  // 標題列本身也有一個「存起來」按鈕（跟底部大顆 CTA 是同一個
  // onSaveQuick，只是文案固定不變）——這裡故意鎖底部那顆，因為它的
  // 文案會隨 amountReady 變化（「存起來，金額晚點補」），是這個測試
  // 真正要驗證的目標。
  const saveBtn = page.getByRole('button', { name: '存起來，金額晚點補' });
  await expect(saveBtn).toBeDisabled();
  await page.getByText('有登記', { exact: true }).click();
  await expect(saveBtn).toBeEnabled();
});
