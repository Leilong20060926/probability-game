# probability-game

# 矮人礦坑 · 黃金探勘所

機率遊戲專題，繁體中文單人網頁遊戲。玩家前端已改接同源後端 API，另有需組員登入的 games／stats／CSV 頁面。尚有後端 review 待修問題及真實瀏覽器驗收缺口，未部署正式蒐集服務。問卷不在目前範圍。

## 本機開發

Node.js ≥ 22.5，不需要安裝 npm 套件。完整試玩請使用下方的後端啟動方式。

```sh
npm test
npm run test:backend
npm run build
```

`npm run dev` 仍只提供靜態資源，沒有 API，不可用來試玩目前的伺服器模式，連線失敗不會切回本機局。`dist/` 是靜態輸出，須搭配同源 API 服務。Google Fonts 載入失敗會使用系統字體。PowerShell 若擋下 npm.ps1，請改用 `npm.cmd`，不需改系統執行原則。

## 後端與前端啟動

後端是 Node 內建模組實作（`node:http` + `node:sqlite`），零 npm 相依，需要 Node ≥ 22.5。會同時服務 `/api/*` 與 `frontend/` 靜態頁，取代上面的 `npm run dev`（兩者不要同時用同一個 port）。

```sh
cp backend/.env.example backend/.env
node backend/scripts/hash-password.mjs "你的密碼"   # 貼到 .env 的 ADMIN_PASSWORD_HASH
npm run backend            # http://localhost:5174
npm run test:backend       # 後端測試
```

細節、API 契約定案、測試結果見 `docs/API.md`、`docs/HANDOFF.md`。

玩家頁為 http://localhost:5174/，組員登入頁為 http://localhost:5174/admin.html。後台不內嵌帳密，登入後才能取得全體資料與下載 CSV；登出需要 CSRF token。

開啟玩家頁會先詢問紀錄模式，尚未選擇前不呼叫遊戲 API：

- **不記錄試玩**：使用同一套遊戲規則在頁面記憶體運作，不發送遊戲 API、不寫 localStorage，不列入後台統計或 CSV。重整／關閉即消失。
- **記錄資料**：透過後端 API 保存每局操作與成績，供組員統計與匯出。重整後需重新選擇此模式，才會恢復原本後端遊戲。

每局開始後不能中途切換紀錄模式，結束後可按「切換紀錄模式」。選不記錄不會刪除以前已寫入資料庫的紀錄。後端故障也不會自動切成試玩模式。

頁面頂部可切換「礦坑遊戲」「紀錄與統計（組員）」「模型與機率分析」。切換不重載遊戲、不暫停倒數；紀錄頁需登入組員，按重新整理取得最新資料。模型頁依 Prob.pdf 第 5–12 頁呈現簡化模型的 PMF／CDF、期望與變異數、事件機率、參數／策略比較與抽樣分布，可調得分門檻與抽牌張數；這些是假設固定策略的文件模型值，不是自由鋪路實測機率。文件 200,000 局模擬沒有在此重跑。

抽到落石會先標示道路約 0.85 秒，再移除；連續落石依序顯示。這只是已確認結果的視覺呈現，期間停用行動、遊戲倒數照常，沒有延後伺服器規則或結算。

## 檔案

- `frontend/src/engine.js`：遊戲規則與事件。
- `frontend/src/app.js`、`style.css`：玩家介面。
- `frontend/src/storage.js`：同源 API transport、建局與行動請求；不再讀寫 localStorage。
- `frontend/src/trial.js`：使用者明確選擇的不記錄試玩，僅保留頁面記憶體狀態。
- `frontend/admin.html`、`frontend/src/admin.js`：組員登入、篩選、分頁、統計與 CSV 下載。
- `backend/src/`：後端實作（Node 內建模組 + `node:sqlite`），`engine-adapter.js` 直接引用 `frontend/src/engine.js` 當權威規則來源。
- `docs/RULES.md`：確認規則與未明定事項。
- `docs/API.md`：後端介面提案與資料定義。
- `docs/HANDOFF.md`：Claude Code 協作交接。

## 資料限制

目前操作需由後端確認並保存至所設定的 SQLite 資料庫。這不代表已部署雲端或已建立備份。舊原型的 localStorage 紀錄保留原樣，未匯入後端，也不當作正式資料。

玩家使用匿名 cookie，重整可恢復同一局；換裝置不會自動恢復同一玩家身分。未翻終點不在回應中揭曉。正式蒐集前須完成 `docs/HANDOFF.md` 的 review 待修、瀏覽器全流程與備份還原驗證。
