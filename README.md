# probability-game

# 矮人礦坑 · 黃金探勘所

機率遊戲專題，繁體中文單人網頁遊戲。首頁預設為三地圖路段版 route-v1（0.4.0），同源後端 API 與不記錄試玩均已接線，另有公開的 games／stats／CSV 紀錄頁。尚有真實瀏覽器驗收缺口，未部署正式蒐集服務。問卷不在目前範圍。

## 本機開發

Node.js ≥ 22.5，不需要安裝 npm 套件。完整試玩請使用下方的後端啟動方式。

```sh
npm test
npm run test:backend
npm run test:route         # 三地圖路段版：規格 A～D 精確值、引擎規則、CLI／提示（約 20 秒）
npm run test:route:sim     # 蒙地卡羅獨立驗證：每圖 200,000 次＋100,000 局（約 35 秒）
npm run build
```

三地圖路段版（route-v1）的精確分析 CLI，例如 `npm run route -- --scenario all --format text`，參數與輸出格式見 `docs/API.md`「route-v1 契約 v0.4」，規則見 `docs/RULES_ROUTE_V1.md`。

`npm run dev` 提供 http://localhost:5173 的靜態資源與 `/shared/`，可選「不記錄試玩」與查看唯讀精確分析；沒有遊戲 API，不能用它驗收記錄模式。連線失敗不會切回試玩。`dist/` 包含四個 `shared/` 模組；記錄模式仍須搭配同源 API。Google Fonts 載入失敗會使用系統字體。PowerShell 若擋下 npm.ps1，請改用 `npm.cmd`，不需改系統執行原則。

## 後端與前端啟動

後端是 Node 內建模組實作（`node:http` + `node:sqlite`），零 npm 相依，需要 Node ≥ 22.5。會同時服務 `/api/*` 與 `frontend/` 靜態頁，取代上面的 `npm run dev`（兩者不要同時用同一個 port）。

```sh
npm run backend            # http://localhost:5174
npm run test:backend       # 後端測試
```

細節、API 契約定案、測試結果見 `docs/API.md`、`docs/HANDOFF.md`。

首次設定時才參考 `backend/.env.example` 建立 `.env`；保留既有 `.env`，不要覆蓋。啟動後重新整理玩家頁，選紀錄模式，再按「開始探勘」。若原本有進行中的 grid 局，須按「結束舊局，準備三地圖」並確認，舊局以提前結束、0 分保留，之後才能開 route-v1；不會自動刪除或重開。

玩家頁為 http://localhost:5174/，紀錄與統計頁為 http://localhost:5174/admin.html。依使用者明確決定，紀錄頁與全體資料／CSV 不需要登入，也不需要設定組員密碼。原 login／logout API 保留相容用途，但前端不再呼叫。

手機區網試玩：電腦執行 `npm.cmd run backend` 並保持開啟，手機與電腦連同一 Wi-Fi，以 `http://電腦的Wi-Fi-IPv4位址:5174/` 開啟（手機不能使用 localhost，那會指向手機自己）。可用 `ipconfig` 查看電腦位址，Wi-Fi 更換或 DHCP 更新後位址可能改變。若連不上，檢查 Windows 是否允許 Node 的私人網路連入，以及 Wi-Fi 是否隔離裝置；不需要關閉整個防火牆。HTTP 本機試玩使用 COOKIE_SECURE=false；正式 HTTPS 才使用 true。這不是公網部署，外部網路不能直接使用此區網位址。

開啟玩家頁會先詢問紀錄模式，尚未選擇前不呼叫遊戲 API：

- **不記錄試玩**：使用同一套遊戲規則在頁面記憶體運作，不發送遊戲 API、不寫 localStorage，不列入後台統計或 CSV。重整／關閉即消失。
- **記錄資料**：透過後端 API 保存每局操作與成績，供統計與匯出。重整後需重新選擇此模式，才會恢復原本後端遊戲。

每局開始後不能中途切換紀錄模式，結束後可按「切換紀錄模式」。選不記錄不會刪除以前已寫入資料庫的紀錄。後端故障也不會自動切成試玩模式。

頁面頂部可切換「礦坑遊戲」「紀錄與統計」「模型與機率分析」。切換不重載遊戲、不暫停倒數；紀錄頁直接顯示資料，按重新整理取得最新資料。新增 ruleset／configId 篩選；按「只看正式三地圖版與模型比較」固定同版本配置，地圖張數與遊戲局數分開呈現。

路段版先選多張牌付款，再按鋪路／硬挖，或只選一張按換牌；岔路先補完牌才選 A／B。落石使當前路段另付任意牌，不再拆道路。已確認 effects 依序顯示，連續落石各有標示；倒數照常。提示顯示本張地圖 Q 值與最佳動作，試玩用 Web Worker 精算，記錄模式使用伺服器提示並記 hint_shown；舊 revision 的提示會丟棄。

分析頁顯示 route-v1 的精確 PMF／CDF、E[X]／E[X²]／Var(X)／P(S)、三圖通關率、動作數與六種單項比較。來源是 `exact_dp`（BigInt 有理數遞迴），忽略超時／放棄；不是模擬估計。正式模型優先用 `/api/route/analysis`，離線 API 時可讀 CLI 產生的 `frontend/data/route-analysis.json`。比較資料可用 `npm run route -- --scenario all --out frontend/data/route-analysis.json` 重算，再 build。正式遊戲配置固定，沒有網頁參數寫入功能。CLI 目前只使用文件列出的參數情境；`maxMaps` 自訂值的精算落差見 HANDOFF 的 P2 review。

## 檔案

- `frontend/src/route-app.js`、`route-view.js`、`route.css`：目前的三地圖玩家介面、付款、教學、重試與舊局處理。
- `frontend/src/storage.js`、`route-storage.js`：同源 API transport、帶識別碼與 revision 的請求；不讀寫 localStorage。
- `frontend/src/route-trial.js`、`route-advisor.js`、`route-hints-worker.js`：記憶體試玩與背景提示。
- `frontend/src/route-analysis-view.js`、`route-records.js`、`frontend/data/route-analysis.json`：精確分析及同版本資料對照。
- `frontend/src/engine.js`、`app.js`、`trial.js`：舊 grid 規則／介面保留相容與回歸測試；首頁已改用 route-main／route-workspace。
- `frontend/admin.html`、`frontend/src/admin.js`：公開紀錄的篩選、分頁、統計與 CSV 下載。
- `backend/src/`：後端實作（Node 內建模組 + `node:sqlite`），`engine-adapter.js` 直接引用 `frontend/src/engine.js`（格子版）與 `shared/route-engine.js`（路段版）當權威規則來源。
- `shared/`：三地圖路段版的共用純模組（設定、規則引擎、BigInt 有理數、精確分析），前後端與 CLI 同一份；後端以 `/shared/*` 白名單提供給瀏覽器。
- `tools/route-version/`：精確分析 CLI、僅供驗證的蒙地卡羅模擬器與測試。
- `docs/RULES_ROUTE_V1.md`：路段版確切規則與實作決定（含平手排序）。
- `docs/RULES.md`：確認規則與未明定事項。
- `docs/API.md`：已實作後端契約與資料定義。
- `docs/HANDOFF.md`：Claude Code 協作交接。

## 資料限制

目前操作需由後端確認並保存至所設定的 SQLite 資料庫。這不代表已部署雲端或已建立備份。舊原型的 localStorage 紀錄保留原樣，未匯入後端，也不當作正式資料。

玩家使用匿名 cookie，重整可恢復同一局；換裝置不會自動恢復同一玩家身分。未翻終點不在回應中揭曉。正式蒐集前須完成 `docs/HANDOFF.md` 的 review 待修、瀏覽器全流程與備份還原驗證。
