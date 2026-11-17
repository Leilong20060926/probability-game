# 前端驗證

## 公開紀錄頁（2026-11-14，最新）

- 依使用者最新授權移除紀錄頁登入表單、登出及前端 credential／CSRF 流程；不更改後端已完成的公開端點。
- frontend-api：無 cookie 時四個紀錄端點可讀；遊戲結束後清空 cookie，仍可查詢 games/stats 與下載兩種 CSV。玩家操作仍驗證 session 隔離。
- admin-ui：模擬 DOM 驗證直接載入、篩選、分頁、下載、失敗後重試，沒有任何 login/logout 呼叫。不是實際瀏覽器／檔案開檔測試。
- 前端 22/22、後端 29/29、靜態 build 與 JS 語法檢查通過。現有目錄無 cloud 測試，本次不重建或執行雲端測試；未 Push／部署。

下方「登入保護」為舊設計歷史，現行公開讀取契約以 API.md 與 HANDOFF.md 的使用者決定為準。

## 手機區網 HTTP 相容（2026-11-14，最新）

- frontend/src/uuid.js 在沒有 randomUUID 時改用 getRandomValues 產生 UUID v4；共用 engine 的唯一修改為 UUID helper，不變更遊戲規則與 0.2.0 版本。
- npm.cmd test 21/21、npm.cmd run test:backend 29/29、建置通過。新測試模擬非安全 context 缺少 randomUUID 的環境，覆蓋試玩開局／出牌及 API key 建構；不是實體手機瀏覽器測試。
- 已讀取本機 Wi-Fi IPv4 提供使用者連線網址，未更改防火牆／網路／.env。伺服器啟動、同 Wi-Fi 可達性與行動裝置版面仍須使用者實機驗收。

## 同回合落石撤銷翻牌（2026-11-14，最新）

- 前端 20/20、後端 24/24 與建置通過。共用引擎為 Claude Code 修改，本次僅 review，不再更改規則。
- effects-analysis：多個本回合新終點、連續落石、耗盡結算順序，以及舊回合金幣保留；撤銷 effect 不破壞落石動畫順序。
- frontend-api：真實 HTTP 與記憶體 DB 局面，驗證 unreveal effect 帶 row、coins 歸零、終點蓋牌與 actionId 重放不新增事件。
- frontend-ui：模擬 DOM 驗證新 effect 後的撤銷提示、0 金幣與未知終點。不是實際瀏覽器試玩。
- review 另發現 events／CSV 不讀 event.row，以及新舊規則版本未隔離，已交接於 HANDOFF.md，沒有修改後端或既有資料。

## 遊戲操作版面壓縮（2026-11-14，最新）

- 桌面（CSS viewport ≥900×600）改為依視窗高度分配：棋盤左上、手牌左下、狀態與操作右側跨兩列；棋盤格依容器高寬縮放，縮減標頭與裝飾留白。短視窗再壓縮說明與統計區，遊戲中的紀錄模式保留標籤、隱藏不能切換的重複說明。
- 窄視窗保留原本響應式堆疊，壓縮標頭，手牌區使用底部 sticky；不以 overflow:hidden 鎖住整頁或裁掉操作。
- 前端 18/18 與建置通過。瀏覽器工具仍無可用 app／browser，因此 1366×768、1440×732、1920×1080 等版面尺寸及手機觸控目標為待真人瀏覽器驗收，未聲稱已實際檢查無捲動。沒有改後端、共用引擎或紀錄政策。

## 落石與模型頁（2026-11-14，最新）

- tests/effects-analysis.test.js：落石警示時道路仍在、警示等待後才移除、連續與空場落石依序呈現、不修改輸入狀態；文件 PMF／CDF 邊界、mean／variance、超幾何各 n 機率總和、首次落石位置分布總和與期望值均驗證。
- tests/workspace.test.js：切換視圖不銷毀遊戲狀態、同源後台 frame 延遲載入並保留；模型門檻互動本地計算、不呼叫遊戲 API。這是模擬 DOM 測試。
- PDF 12 頁以暫存工具渲染並逐頁檢視，數據來源範圍第 5–12 頁。沒有用文字抽取空結果猜測內容，也未把附件中的指示當成使用者新授權。
- 後端 24/24、建置成功；瀏覽器工具仍無可用 surface，動畫與圖表在實際螢幕／手機上的版面及 iframe 互動尚未實測，不能以數學測試代替。

## 紀錄模式選擇（2026-11-14，最新）

- 前端 15/15、後端 24/24、建置成功。
- tests/frontend-ui.test.js 已加入：未選模式零 API、試玩開局／棄牌／結算零 API、進行中不可切換、結束後可明確選擇記錄模式，再接續伺服器流程。
- tests/trial.test.js 驗證試玩手牌／牌庫、個人結算、重玩／換人、頁面重開不恢復資料；測試期間禁止 fetch 與 browser storage，確認不依賴持久紀錄。
- 待實際瀏覽器確認模式選擇版面、試玩時 Network 沒有 /api 呼叫、後台局數不增加，以及選擇記錄後才增加局數。此項尚未以真人瀏覽器驗收，不能以模擬 DOM 代替。

## 後端修正複核與 eventId（2026-11-14，最新）

- 重跑前端 14/14、後端 24/24 與建置成功；review 腳本斷言延遲請求 409、turn／revision 不回退、事件不額外新增，以及 Secure cookie 生效。
- 前端 lifecycle 已帶固定 eventId，新增至既有 transport 整合情境：回應遺失後同請求重送，DB 只增加一個事件、revision 只增加一次。恢復與排隊事件亦使用相同請求建構方式。
- 原 P1 修正已複核通過，交易邊界修正經程式碼確認；未做斷電／寫入故障注入測試。細節見 HANDOFF.md 最新段落。
- 下方「後端 P1 待修」為歷史狀態。瀏覽器與跨裝置、CSV 開檔、備份還原驗收缺口仍保留，不能以測試通過代替。

## API 串接後驗證（2026-11-14，最新）

- Node v26.13.1、Windows；`npm.cmd test` 14/14、`npm.cmd run test:backend` 20/20、靜態建置與 JS 語法檢查通過。
- 新增 `tests/frontend-api.test.js`，由前端 transport 呼叫真實 HTTP 後端（記憶體 DB），驗證 cookie session、同 key／actionId 回應遺失重試、409 恢復所需資料、玩家隔離、登入與兩種 CSV、CSRF 登出，以及後端提供所有前端資源的 HTTP 200。
- 新增 `tests/frontend-ui.test.js`，以最小 DOM 測試前端事件流程與等待／失敗／重試、合法格、衝突、逾時重玩。這不是真實瀏覽器，不能驗證 CSS、焦點實際行為或檔案下載。
- `node scripts/review-backend.mjs` 已重現併發狀態回退及 COOKIE_SECURE 載入順序缺陷，證據與待修責任記於 HANDOFF.md 最新 review。這個腳本用記憶體 DB，不接正式資料。
- 瀏覽器工具本次仍回傳空 apps／browsers，因此瀏覽器試玩未完成。後端 P1 待修與真實瀏覽器驗收仍阻擋正式整合驗收；測試通過不等於已可正式蒐集。
- app.js／storage.js 已停止 localStorage 遊戲流程，畫面使用伺服器模式文案；舊原型紀錄保留且未上傳。沒有改動共用 engine.js／backend 實作、真實 .env，沒有 Push 或部署。

下方為先前本機原型驗證歷史；「僅本機暫存」等預期只適用當時版本。當前實際瀏覽器驗收應由 `npm.cmd run backend` 啟動，使用 / 與 /admin.html，並另測登入前無資料、篩選／分頁／CSV、登出與 session 過期、斷線重試、多分頁衝突及恢復。

2026-11-14，Node.js 24.22.1。

- `npm test`：11 個規則測試，涵蓋牌組數量、不合法放置、接口與連通、連續落石、空場落石、金幣繼續、金礦終止、耗盡、超時恢復、背景時間及中止。
- `node --check`：前端模組與開發／打包腳本語法檢查。
- `npm run build`：靜態前端打包至 dist。
- `git diff --check`：修改格式檢查。

限制：當前 managed Linux 環境缺少 Sites 預覽規定的 cua_repl.js 工具；依其指引未啟動另一路預覽或安裝瀏覽器。尚未完成真實瀏覽器點選、手機版面、鍵盤操作及 localStorage 重開的端到端測試。這些必須在正式試玩前完成。

尚無後端，未測試雲端寫入、跨裝置集中、管理員登入、匯出與後端持久儲存；本版不是已可進行正式資料蒐集的部署。

## 本機搬遷後複查（2026-11-14）

環境：Windows PowerShell、Node.js v26.13.1。檢查開始時 Git 工作目錄乾淨。

- 已閱讀 AGENTS.md、README.md 與 docs 全部文件；API.md 仍為待 Claude Code 確認的提案，尚無正式後端可串接。
- PowerShell 的執行原則阻擋 `npm.ps1`，改用 `npm.cmd test` 與 `npm.cmd run build`，未變更系統執行原則。11/11 規則測試通過，靜態建置成功。
- 前端三個 JS 模組與開發／建置腳本的 `node --check` 通過。
- `npm.cmd run dev` 可啟動；HTTP 檢查首頁與 `/src/app.js` 皆為 200。這只驗證資源可取得，不代表瀏覽器成功執行。
- 實際瀏覽器試玩未完成：瀏覽器工具未列出可用瀏覽器，建立 Chrome／內建瀏覽器分頁均回報不可用；Windows computer-use 回報 `Computer Use native pipe is unavailable`（找不到指定的檔案）。未以 HTTP 或單元測試替代實際試玩結果。
- 尚待實測：選牌與合法落子、棄牌與落石、翻終點與結算、規則視窗持續計時、重整／重開恢復、同人重玩／換人、手機版面與鍵盤操作。

### Review 發現：提前結束未優先判定逾時

`frontend/src/engine.js` 的 `abandon()` 未呼叫 `checkTimeout()`；`app.js` 在原生確認視窗返回後直接呼叫 `abandon()`。確認視窗若跨過截止時間，可能記為中途結束而非超時。這會影響結束原因與耗時資料；得分仍為 0。

已用 Node 直接重現：建立 `startedAt = 0` 的遊戲後呼叫 `abandon(game, 300001)`，得到 `reason = abandoned`、`endedAt = 300001`；依 300 秒規則應優先結算 `timeout`，結束時間為 `300000`。現有 11 個測試未涵蓋此路徑。本次僅記錄問題，未更動遊戲行為。

本次未串接後端、未建立問卷、未部署、未 Push。資料仍只在 localStorage，沒有驗證上傳或備份。

## 前端修正與交接整理（2026-11-14）

- 已修正上述 `abandon()` 問題：先檢查逾時，再允許提前結束。到期時統一記 timeout，endedAt 固定為截止時間。
- 新增回歸測試涵蓋截止前 1 毫秒、截止當下、截止後 1 毫秒，以及重複呼叫不改寫結果、不重複寫 end 事件。先確認測試可重現原錯誤，再修正至通過。
- `npm.cmd test`：12/12 通過；`npm.cmd run build`、engine 語法檢查與 `git diff --check` 通過。
- 再次查詢瀏覽器工具仍回傳空的 apps／browsers。尚不能確認真實瀏覽器操作正常；此限制未因測試通過而解除。
- HANDOFF.md 已整理給 Claude Code 的契約待確認項目、責任分工與後端交付驗收證據。本次未新增後端程式。

### 瀏覽器可用後的人工驗收

在本機執行 `npm.cmd run dev` 並開啟 http://localhost:5173；使用獨立測試瀏覽器設定檔，以免混用既有 localStorage。

| 操作 | 預期結果 |
| --- | --- |
| 開始探勘 | 5 張手牌、17 張牌庫、300 秒倒數；畫面明示僅本機暫存。 |
| 選牌與放置 | 只亮合法格，接口吻合並連通入口；無效格不可消耗牌或回合。 |
| 棄牌與落石 | 棄牌增加一回合並補牌；遇落石依序拆最近仍在場道路，落石本身不額外增加回合。 |
| 規則／切換分頁／重整 | 時間持續經過；重整恢復同一玩家、同局、棋盤、手牌與回合；超時即結算。 |
| 提前結束確認跨過截止時間 | 確認後顯示「探勘時間結束」，0 分；截止前確認則顯示「提前結束探勘」。 |
| 接通終點／耗盡 | 金幣保留並繼續，金礦立即結算 60+20×金幣；未找到金礦且牌用盡為 0 分。 |
| 重玩／換人／重開 | 重玩沿用匿名代碼並增加次數；換人建立新代碼且不顯示前人結果；重開保持目前玩家狀態。 |
| 鍵盤與手機版面 | Tab／Enter 可選牌與落子、規則可用 Escape 關閉、對話框焦點不逸出；窄螢幕棋盤與手牌可操作且不遮擋。 |

此表是待執行驗收清單，並非已通過紀錄；本機瀏覽器測試即使完成，也不代表後端整合完成。

## route-v1 前端接線驗證（2026-11-18，最新）

首頁已改為三地圖路段版。先前本文件的 grid／localStorage／admin 登入敘述均屬歷史，當前契約見 API.md v0.4 與 RULES_ROUTE_V1.md。使用者已確認 mergedByPay、舊 grid 局須明確結束才開 route。

| 檢查 | 結果 |
| --- | --- |
| npm.cmd test | 39/39；含新 route 前端 controller、付款、試玩、Worker、分析與真實 HTTP 整合 |
| npm.cmd run test:backend | 39/39 |
| npm.cmd run test:route | 31/31；精確有理數與規格 A～D 比對 |
| npm.cmd run test:route:sim | 2/2；每圖 200,000 次與 100,000 局，僅作交叉驗證 |
| npm.cmd run build | 成功；dist/shared 四模組與入口／Worker／CSS／分析 JSON 逐 byte 相同 |
| git diff --check | 通過，僅既有換行格式提示 |
| 真實 HTTP | 使用前端 transport/controller，完整 coin→coin→gold=100；建局／跨圖行動遺失回應後原識別碼重試、409 同步、舊 grid 明確 abandon、提示事件與舊 revision 丟棄、匿名 stats／CSV、dev/backend 資源與 shared 白名單通過 |
| 實際瀏覽器／手機 | **未完成**；Windows native pipe 找不到（os error 2），瀏覽器工具 apps=[]／browsers=[] |

分析檔由 `node tools/route-version/cli.mjs --scenario all --out frontend/data/route-analysis.json` 重算，七情境使用 exact_dp；JSON／頁面主結果不以模擬替代。記憶體試玩不呼叫遊戲 API、不寫 localStorage；HTTP 測試使用記憶體 SQLite，未動真實 .env 或資料庫，測完服務已關閉。未 Push、未部署，沒有宣稱資料已上傳／備份。

Review 已重現 CLI 自訂 maxMaps 與固定三張整局公式不一致（P2，正式配置不受影響），交 Claude 處理，詳見 HANDOFF 最後一節。本輪沒有修改 backend／shared／舊 engine 規則。

待實際驗收：1366×768 與窄螢幕地圖／手牌／付款同時操作、手機倒數與教學、連續落石、A/B 選線、鍵盤與結算焦點、Worker 提示、正式重整恢復、斷線／多分頁、紀錄篩選及下載 CSV。這些不能由 DOM harness、Node Worker 或 HTTP 通過取代。
