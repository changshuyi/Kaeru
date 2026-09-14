import { test, expect } from '@playwright/test';
import { seedTrip } from './helpers.js';

// 折疊手機閤起來（窄封面螢幕）跟展開（寬內螢幕，接近平板）兩種極端寬度
const CASES = [
  { label: '闔起-封面螢幕', width: 280, height: 653 },   // 比 Z Flip 封面螢幕更窄的極端值
  { label: '闔起-封面螢幕2', width: 344, height: 882 },  // Z Fold 系列封面螢幕常見寬度
  { label: '展開-內螢幕', width: 717, height: 512 },      // Z Fold 展開後常見邏輯寬度（橫向偏方形）
  { label: '展開-內螢幕2', width: 884, height: 1104 },    // 展開後直向持握
];

for (const c of CASES) {
  test(`折疊手機情境: ${c.label} (${c.width}x${c.height})`, async ({ browser }) => {
    const page = await browser.newPage({ viewport: { width: c.width, height: c.height } });
    await seedTrip(page, {
      trips: [{ id: 't1', name: '大阪五日遊', departure: '2026-09-20T18:30' }],
      activeId: 't1',
    });
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const metrics = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      scrollHeight: document.documentElement.scrollHeight,
    }));
    console.log(`${c.label} (${c.width}x${c.height})`, JSON.stringify(metrics));
    expect(metrics.scrollWidth).toBeLessThanOrEqual(c.width + 1);

    await page.screenshot({ path: `/tmp/foldable-${c.label}-${c.width}x${c.height}.png`, fullPage: false });
    await page.close();
  });
}
