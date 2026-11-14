# probability-game

# 矮人礦坑 · 黃金探勘所

機率遊戲專題，繁體中文單人網頁遊戲。前端開發版本已具備鋪路、抽牌、落石、翻終點、個人成績和本機記錄；後端由 Claude Code 接續，尚未串接雲端。問卷不在目前範圍。

## 本機開發

Node.js 22 以上，不需要安裝 npm 套件。

```sh
npm run dev
# http://localhost:5173
npm test
npm run build
```

`PORT` 可改開發連接埠。`dist/` 是靜態輸出，可交由後端服務；開發伺服器不適合正式部署。Google Fonts 載入失敗會使用系統字體。

## 檔案

- `frontend/src/engine.js`：遊戲規則與事件。
- `frontend/src/app.js`、`style.css`：玩家介面。
- `frontend/src/storage.js`：本機保存；尚未實作後端上傳。
- `docs/RULES.md`：確認規則與未明定事項。
- `docs/API.md`：後端介面提案與資料定義。
- `docs/HANDOFF.md`：Claude Code 協作交接。

## 資料限制

目前紀錄只存在本瀏覽器的 localStorage，包含未揭曉的測試遊戲狀態，因此僅供開發試玩，不適合正式課堂集中蒐集。重整會恢復原局、倒數照常經過；清除網站資料會遺失，換裝置不會同步。

正式版須由後端保存隱藏資訊、驗證操作、集中持久儲存，組員驗證後才能查詢及匯出。不要把此版本的本機紀錄當成已備份的研究資料。