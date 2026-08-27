import { defineConfig } from '@playwright/test';

// E2E 測試設定——這個 App 沒有後端，測試對象永遠是靠 `vite preview`
// 起的靜態產物，不是 dev server：dev server 開著 React StrictMode，
// 會把 mount 一次的 effect 多跑一次，QuickAddFlow 裡「一進來就自動
// 跳出來源選單」那個 openedRef guard 在 StrictMode 下會被誤判成已經
// 跳過一次，導致選單完全不會自動打開——這不是真正的 bug，只是
// StrictMode 的開發期雙重呼叫，正式環境不會發生，但如果對著 dev
// server 測，會看到跟真實使用者體驗不一致的假象。所以這裡用
// webServer 自動先 build 再 preview，測試永遠對著跟使用者裝到手機上
// 一致的產物跑。
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:5183',
    viewport: { width: 390, height: 844 },
  },
  webServer: {
    command: 'npm run build && npm run preview -- --port 5183',
    url: 'http://localhost:5183',
    reuseExistingServer: !process.env.CI,
    timeout: 60000,
  },
});
