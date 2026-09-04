import { defineConfig } from 'vitest/config';

// 獨立的 vitest 設定，不跟 vite.config.js 共用——這裡只測純函式
// （src/lib/*.js、src/exportData.js），不需要瀏覽器環境，用 Node 環境
// 跑最快。這些檔案都沒有 JSX 語法，不需要 @vitejs/plugin-react 的
// transform（拆檔前 appLogic.test.js 是直接從 src/App.jsx 這個 JSX
// 檔案 import 純函式出來測，那時才需要這個 plugin）。
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.js'],
  },
});
