import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// 獨立的 vitest 設定，不跟 vite.config.js 共用——這裡只測純函式
// （src/App.jsx 裡 export 出來的計算邏輯、src/exportData.js），不需要
// 瀏覽器環境，用 Node 環境跑最快；也不用 react() 這個 plugin 本身的
// 功能（沒有測任何元件渲染），但 App.jsx 檔案開頭有 JSX 語法，沒有
// 這個 plugin transform 會直接解析失敗。
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'node',
    include: ['src/**/*.test.js'],
  },
});
