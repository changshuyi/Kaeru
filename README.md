# Kaeru

日本 2026 年 11 月退稅新制（先付後退 / リファンド方式）的旅客小幫手。
把每一張免稅收據集中管理，追蹤處理狀態、期限和達標情況，出境前切到查驗模式出示給海關。

## 跑起來

```bash
npm install
npm run dev
```

## 檔案

```
index.html                  字型載入、viewport
src/main.jsx                進入點
src/App.jsx                 App 本體：狀態、資料持久化、畫面路由
src/storage.js              window.storage 的本機實作，底層是 localStorage
src/receiptScanner.js       自建 Capacitor plugin（文件掃描／OCR／開系統設定）的註冊
src/exportData.js           CSV/ZIP 匯出、照片統計等純函式
src/index.css               Tailwind 三行 + body 底色

src/constants/               色票、字體、機場資料、App 層級常數
src/i18n/                    雙語字典（translations.js）、FAQ／情境模擬內容（content.js）
src/lib/                     純函式工具：金額、日期、圖片處理、OCR 解析…
src/hooks/                   共用 hook：返回鍵堆疊、倒數計時、相機/相簿流程…
src/components/ui/           可重複使用的畫面元件（Badge、Card、DateField…）
src/components/views/        五個主分頁（總覽／收據／查驗／FAQ／設定）
src/components/sheets/       彈窗、面板（行程、新增收據、匯出、刪除確認…）
```

`App.jsx` 原本是單一 11,000+ 行的檔案，上架前拆成上面這個結構——拆分是
純粹的搬動程式碼＋補 import/export，沒有改任何邏輯或文案。`App.jsx`
現在只保留最外層的狀態、資料持久化 effect 跟畫面路由，實際的元件都
從其他資料夾 import 進來組裝。

App.jsx 用 `window.storage` 讀寫資料，介面是 get / set / delete / list，全部回 Promise。
本機由 `storage.js` 補上，之後要換 IndexedDB 或後端只要改那一個檔案。

主資料存在 `kaeru:v2`，收據照片一張一個 key，格式是 `kaeru:photo:<id>`。

## 設計

底色白，其餘用莫蘭迪色。色票集中在 `src/constants/theme.js` 的 `C`，改那一組就會全站生效。

| 用途 | 色碼 |
| --- | --- |
| 外圍底 | `#F2F0ED` |
| 頁面 / 卡片 | `#FFFFFF` |
| 填色區塊 | `#F4F2EF` |
| 主色 灰藍 | `#77899A` |
| 深灰藍 | `#5C6D7C` |
| 淺灰藍 | `#DFE5EA` |
| 灰綠（達標、正確） | `#93A392` |
| 灰赭（提醒、失誤） | `#B08D74` |
| 文字 | `#494640` |
| 次要文字 | `#8B857D` |
| 線 | `#E1DCD5` |

字體是 Noto Sans TC 和 Noto Sans JP，字距 0.01em。
標誌 `FrogMark` 是純 SVG 的青蛙正臉，接 size 和 color 兩個參數。

## 畫面

| 畫面 | 內容 |
| --- | --- |
| 總覽 | 起飛倒數、建議抵達時間、金額統計、出發當天流程 |
| 收據 | 依「店家＋日期」分組，狀態篩選，新增和編輯 |
| 查驗 | 待查驗清單，中日文對照，出示給海關 |
| FQA | 分類問答、小撇步、情境模擬 |
| 設定 | 行程、匯率、語言、清空資料 |

面板類（行程、新增收據、收據明細）是置中彈窗，功能選單是從標題列漢堡往下展開的下拉。

## 規則邏輯

依據観光庁 消費税免税店サイト：

- 同一間店、同一天，稅抜合計滿 5,000 円，不分商品種類
- 海關查驗以一張收據為單位，缺一項整張都不能退
- 拆封、穿過不影響；在境內吃掉用掉才會失效，這時要向海關人員申報
- 購買日起 90 天內出境並完成查驗
- 稅抜單價滿 100 萬円可能要出示鑑定書或保證書
- 託運行李前要辦完
- 稅率：食品 8%，酒類、外食和其他商品 10%

達標判定用稅抜金額，不是含稅金額。

## 還沒做

- 真正的離線（Service Worker）和推播提醒
- 收據 OCR
- 機場自助機台的位置資料
