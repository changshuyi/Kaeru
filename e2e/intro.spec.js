import { test, expect } from '@playwright/test';

// 首次開啟介紹（IntroScreen）。全新安裝的情境不用 seedTrip：什麼都
// 不寫進 localStorage 才是真的「第一次打開」，重新整理也不會像
// addInitScript 那樣把剛存的 introSeen 蓋回去。

test('全新安裝：先看到介紹，一路按到「開始使用」才進總覽，重開不會再出現', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('日本退稅小幫手')).toBeVisible();

  for (let i = 0; i < 3; i++) await page.getByRole('button', { name: '下一步' }).click();
  await expect(page.getByText('到了機場，')).toBeVisible();
  // 最後一頁沒有「略過」，只剩「開始使用」
  await expect(page.getByRole('button', { name: '略過' })).not.toBeVisible();
  await page.getByRole('button', { name: '開始使用' }).click();

  // 介紹是蓋在總覽上面的，總覽的字一開始就算 visible；要等介紹本身
  // 消失、introSeen 寫進 storage 之後才 reload，不然會跟存檔搶跑。
  await expect(page.getByRole('button', { name: '開始使用' })).not.toBeVisible();
  await expect
    .poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('kaeru:jptax:v2')).settings.introSeen))
    .toBe(true);
  await page.reload();
  await expect(page.getByText('還不知道你什麼時候回國')).toBeVisible();
  await expect(page.getByRole('button', { name: '下一步' })).not.toBeVisible();
});

test('第一頁就能略過', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '略過' }).click();
  await expect(page.getByText('還不知道你什麼時候回國')).toBeVisible();
});

test('介紹畫面切成日文，進 App 之後也是日文', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '日本語' }).click();
  await expect(page.getByText('免税リファンドの相棒')).toBeVisible();
  await page.getByRole('button', { name: 'スキップ' }).click();
  await expect(page.getByRole('button', { name: '日本語' })).not.toBeVisible();
  await expect(page.getByText('免税リファンドの相棒')).not.toBeVisible();
});

test('舊使用者升級：已經有收據、設定裡沒有 introSeen，不跳介紹', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      'kaeru:jptax:v2',
      JSON.stringify({
        items: [
          { id: 'r1', shop: 'UNIQLO', date: '2026-11-06', incl: 6600, rate: 10, status: 'purchased', tripId: 't1', hasPhoto: false },
        ],
        settings: { rate: 0.21, lang: 'zh', photoPermissionPrimed: true },
        trips: [{ id: 't1', name: '大阪', departure: '2026-11-13T18:30' }],
        activeId: 't1',
      }),
    );
  });
  await page.goto('/');
  await expect(page.getByText('大阪').first()).toBeVisible();
  await expect(page.getByRole('button', { name: '略過' })).not.toBeVisible();
});
