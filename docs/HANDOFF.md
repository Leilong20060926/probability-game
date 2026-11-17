# 協作交接

## Codex 手機區網連線相容性預告（2026-11-14）

為支援使用者以手機連本機 Wi-Fi HTTP 網址，準備在前端加入 UUID v4 helper：優先 crypto.randomUUID，不可用時用 crypto.getRandomValues。共用 engine.js 僅將 newGame 的 UUID 呼叫改用 helper，不更改洗牌、翻牌、計分、計時或版本語意；此為共用檔案修改前的協作紀錄。storage.js 與 trial.js 同步採用 helper，會一起跑 npm test、test:backend 及 build。沒有更改防火牆或公開部署。

完成：已新增 uuid.js 並接入 engine／storage／trial；保留 Claude Code 最新 VERSION=0.2.0 與所有後端修正。新增測試模擬 randomUUID 不存在，驗證試玩開局／出牌、玩家代碼及 actionId／eventId／建局 key 皆透過 getRandomValues 正常產生 UUID v4，未使用 Math.random 作識別碼亂數來源。前端 21/21、後端 29/29、建置通過；未做實體手機連線或防火牆驗收。背景依據：https://developer.mozilla.org/en-US/docs/Web/API/Crypto/randomUUID 與 https://developer.mozilla.org/en-US/docs/Web/API/Crypto/getRandomValues 。沒有改動 .env、網路或防火牆設定，未 Push／部署。

> 最新狀態請見本檔末尾「使用者確認的規則變更：同回合落石撤銷翻牌」；先前進度與待確認清單保留為協作歷史。

## 目前進度（Codex，2026-11-14）

- 前端無框架 ES modules，Node >=22，無 npm 執行期相依。`frontend/` 可由任何後端靜態服務。
- `engine.js`：實際連通與接口檢查、5 張起手、18 道路+4 落石、不放回、金幣／金礦、300 秒、回合事件。
- `app.js`：繁體中文響應式棋盤、選牌／合法格／棄牌、規則視窗、個人成績、換人、原局恢復。
- `storage.js`：localStorage 保存每個合法操作與結算，明示本機暫存。尚無雲端／後端／組員頁面。
- 已記錄 touch/pointer 操作類型、分頁隱藏／回到前景／重整恢復事件，操作耗時含背景時間。
- 使用者指定 Claude Code 主要做後端；Codex 做前端與 review。未對 Claude Code 發出訊息或聲稱已串接。

## Claude Code 請接手

1. 先讀 RULES 與 API，對契約提出修正再串接。請保留前端及其行為測試。
2. 選擇後端框架與持久資料庫，建立資料遷移、環境變數範例（不要提交真實密碼）、管理驗證。
3. 正式模式由伺服器持有隱藏資訊與權威狀態。請勿直接信任本機 engine 上傳的結果。
4. API contract 若有變更，更新 API.md 並在下方留待辦；Codex 將把前端 storage/engine 呼叫改為 API adapter。
5. 準備整合測試：重試冪等、非法落子、連續落石、逾時、恢復、跨玩家授權、未登入不能讀統計／CSV、重啟保留資料。
6. 實作完成後留啟動命令與測試結果，供 Codex review。

## Codex 後續

- 接上確認後的 API，加入狀態修訂、等待中／失敗／重試提示，正式模式不回傳隱藏金礦。
- 製作受後端驗證保護的組員統計介面，不在玩家頁顯示全體成績。
- Review 後端計分、邊界、授權、持久化及 CSV，再驗證完整流程。
- 規則待確認：入口／終點接口等，見 RULES 的暫行規則。

## 協作備註

### Claude Code 後端完成（2026-11-14）

依使用者指示：先讀 AGENTS.md／docs，確認 API 契約，再實作後端；保留現有前端；不做問卷、不自行 Push、不部署。契約定案已寫回 `docs/API.md` 的「契約定案 v0.2」小節（逐項回覆本檔先前列的待確認清單），以下只列重點與交回證據。

**框架與資料庫**：Node 內建 `node:http` + `node:sqlite`（零 npm 相依，延續專案慣例），需要 Node ≥ 22.5；`package.json` 的 `engines.node` 已調整，新增 `backend`/`backend:migrate`/`test:backend` script，**原有 `dev`/`build` 未動，`test` 改成 `node --test tests`（明確指定路徑）**——原本 `node --test` 沒給路徑，加入 `backend/tests/` 後會被一併掃到，為避免前端 `npm test` 意外吃到後端測試，才加上路徑；行為與原本（12 個 engine 測試）完全一致，已驗證。

**⚠️ 請注意的跨界相依**：`backend/src/engine-adapter.js` 直接 `import` `frontend/src/engine.js` 當唯一規則引擎，沒有複製第二份規則邏輯（原因：避免 `docs/RULES.md` 提醒的「不同版本不可混用」）。這代表 **往後修改 `frontend/src/engine.js` 會同時改變後端判定**。請在改動該檔前先在這裡留言，我們一起跑 `npm test` 與 `npm run test:backend` 確認雙邊都過。`frontend/` 其餘檔案、`scripts/dev.mjs`、`dist/` 完全沒有被後端碰過。

**目錄**：`backend/src/`（server、db、engine-adapter、gameView、session、idempotency、ratelimit、csv、errors、password、players-repo、games-repo、admin-repo、routes/）、`backend/migrations/0001_init.sql`、`backend/scripts/hash-password.mjs`、`backend/.env.example`、`backend/tests/`。

**啟動方式**：

```sh
cp backend/.env.example backend/.env   # 填 ADMIN_USERNAME，用下行指令產生密碼雜湊
node backend/scripts/hash-password.mjs "你的密碼"   # 貼到 .env 的 ADMIN_PASSWORD_HASH
npm run backend:migrate   # 可選，server 啟動時也會自動套用
npm run backend           # http://localhost:5174，同時服務 /api/* 與前端靜態頁
```

`DB_PATH` 預設 `backend/data/game.db`（已加入 `.gitignore`）；本機 http 開發請保持 `.env` 的 `COOKIE_SECURE=false`，正式有 HTTPS 才設 `true`，否則瀏覽器會拒絕 cookie。

**測試結果（本機 Windows、Node v26.13.1，2026-11-14）**：

- `npm test`：12/12 通過（既有前端 engine 測試，未受影響）。
- `npm run build`：成功，`dist/` 產出不變。
- `npm run test:backend`：**20/20 通過**，涵蓋：
  - 真實 HTTP 全局流程（用回傳的 board/hand 當機器人找合法落點，不依賴已知 goldRow，跑到 `gold`/`exhausted` 並驗證分數）。
  - `Idempotency-Key`／`actionId` 重放不重複執行；同 key 不同內容 409；已有進行中遊戲再建局 409 `GAME_IN_PROGRESS`。
  - `expectedRevision` 衝突回 409 並附最新安全狀態；非法落子 422 且不消耗卡牌/回合。
  - 換玩家後讀不到、也動不了前一位玩家的遊戲；未登入讀 `current` 401。
  - 逾時優先於讀取/行動/生命週期事件判定；逾時只結算一次；`abandon` 不能覆蓋已經逾時的結果；背景「restored」事件若已過期會回報 `timeout` effect。
  - 組員：未登入讀 games/stats/csv 全部 401；密碼錯誤限流（5 次後 429，鎖定期間密碼正確也擋下）；CSRF 不符擋下登出；登出後 session 失效。
  - 空統計資料不產生 NaN（`goldFinishRate`/`avgScore`/`avgDurationMs` 回 `null`）；局數與不重複玩家數分開計算。
  - CSV：BOM、逐欄位 quote/escape、公式注入前綴防護。
  - 關閉再重開資料庫檔案（模擬重啟）後，遊戲資料仍可讀回。

**手動驗證（curl，對應 `docs/API.md` 範例）**：已實際跑過玩家建立 → 建局（含 Idempotency-Key 重放）→ 已有進行中遊戲再建局 409 → 落子 → actionId 重放 → revision 衝突 → 非法落子 422 → lifecycle → 換玩家隔離 → 組員登入/限流/stats/games/export.csv/events.csv/CSRF 登出，皆與 `docs/API.md` 定案一致。範例請求/回應已在本次對話記錄，若需要書面範例可再整理成獨立檔案。

**尚未做（刻意，依指示）**：未建問卷、未 Push、未部署、`.env` 只有範例檔無真實密碼。多實例部署時的限流（目前是單機記憶體限流）與跨機器集中式 session 尚未處理，教室單機／單程序部署沒有這個問題，之後要水平擴充再提出。

### 待 Codex Review 清單

1. `docs/API.md` 的「契約定案 v0.2」：尤其是「結束後不揭曉未翻終點」「GAME_IN_PROGRESS 不先自動結束舊局」「lifecycle 另開端點」這三個設計選擇是否符合預期。
2. `backend/src/engine-adapter.js` 的跨界相依方式（import 而非複製）是否接受；接受的話請改動 `frontend/src/engine.js` 前先同步。
3. 把現有 `frontend/src/app.js`、`storage.js` 接到這組 API：cookie 已設 `credentials` 需要時 fetch 要帶 `credentials: 'include'`（同源其實預設就會帶，但保留提醒）；斷線/等待/409 重試提示依 `docs/HANDOFF.md`（Codex 後續段落）處理。
4. 瀏覽器實測（本次僅有自動化測試與 curl，未用瀏覽器跑過玩家到組員全流程）。

### Codex 本機複查（2026-11-14）

- Windows 使用 `npm.cmd test`、`npm.cmd run build` 成功，11/11 規則測試通過；詳見 VALIDATION.md。
- 實際瀏覽器試玩受工具阻擋，尚未完成；HTTP 200 與 engine 測試不構成前後端整合驗證。
- 已修：前端 `abandon()` 先處理逾時，避免確認視窗跨過截止時間後仍記為 abandoned。新增截止前／當下／之後與重複結算測試，目前 12/12 通過。後端實作亦需由伺服器優先判定截止時間。
- API 契約尚待雙方確認；未串接、未部署、未 Push。

## 給 Claude Code 的後端交接清單

本階段使用者只要求確認前端與整理交接，不實作後端。下列為後續工作清單，不代表後端已開工或 API 已確認；先對齊 API.md，再進入正式串接。

### 先確認契約

| 項目 | 現有提案與待確認內容 |
| --- | --- |
| 玩家與遊戲 | 依 API.md 的 players、switch、games、current、actions 路徑；匿名能力憑證使用伺服器 cookie，不能以 playerId 代替授權。明定已有進行中遊戲時再次建立遊戲的回應。 |
| 安全狀態 | 正式模式只回傳 GameView；未揭曉終點不含 reward，所有回應與 effects 均不得暴露未抽牌庫、goldRow 或內部事件。確認 board／targets 是否涵蓋入口與固定終點，以及結束後未翻礦藏的顯示策略。 |
| 冪等與衝突 | 確認建立遊戲與行動 key 的作用範圍、保留期限、重送回應；revision 衝突為 409，仍需定義含最新安全狀態的精確 JSON 格式。API.md 的 error 格式目前只有 code／message。 |
| 計時與順序 | 每次讀取／行動先由伺服器判斷逾時；到期的 abandon 亦應記 timeout。操作依出牌→翻終點→金礦立即結束，否則抽牌／連續落石→耗盡處理。前端以 serverNow 校正顯示。 |
| 背景事件 | 本機目前記 hidden／visible／restored，但提案 actions 僅接受 place／discard／abandon。需確認生命週期事件如何接收、去重與標記客戶端來源；不能拿客戶端時間作權威計時。 |
| 組員功能 | 確認登入方式、session／CSRF 與登出撤銷；games、stats、兩種 CSV 的篩選、分頁、欄位與錯誤格式。未授權不得取得資料。 |
| 規則 | RULES.md 的暫行入口／終點接口等規則保持明示；若有變更，先更新文件並協調前端對照測試。 |

以上待確認內容不在本次直接改寫為既定契約。

### 實作與前端銜接責任

- Claude Code：提出框架與持久資料庫、遷移與備份方式；實作權威遊戲狀態、玩家與組員授權、事件與結果同交易儲存、統計與 CSV，以及後端測試。
- Codex：待契約及可執行後端交付後，將 app.js 對本機 engine／storage 的呼叫接入 API adapter，補等待／失敗／重試、revision 衝突與斷線提示，再 review。斷線不得悄悄改成本機局。
- 現有 storage.js 保存完整本機狀態，含測試用隱藏資訊，不能直接當作正式後端資料格式或可信上傳來源。現有本機紀錄保留 local 標記；若未來需要匯入，須另定流程並標記 unverified_local。
- 玩家介面只顯示本局個人成績；組員頁面需待後端授權完成後製作。不製作問卷，不加入公開全體統計。

### 後端交回 review 時必備證據

- 啟動／測試命令、環境變數範例、資料庫遷移、實際 API request／response 範例與契約變更紀錄；不提交真實憑證。
- 規則測試及端到端測試：合法／非法操作、連續與空場落石、金幣／金礦／耗盡、截止時間與 abandon 競合、同局恢復。
- 授權與併發測試：更換玩家後不能取得前人遊戲；未登入組員不能讀 games／stats／CSV；重試不重複出牌；多分頁 revision 衝突可恢復；公開回應無隱藏資訊。
- 持久化與匯出驗證：後端重啟後仍在、兩裝置資料集中、事件／結果一致、備份與還原、空統計不產生 NaN、CSV 公式注入防護及實際開檔核對。
- Codex 再用瀏覽器驗證玩家到組員完整流程。上述證據未完成前，不標記整合完成，也不公開部署正式資料蒐集服務。

## Codex API 串接與後端 review（2026-11-14）

### 已交付的前端

- app.js／storage.js 已切至同源 cookie API，不再建立本機遊戲、不讀寫 localStorage；舊本機紀錄未刪除或上傳。共用 engine.js 未修改，只引用 card／canPlace 作呈現與合法位置預覽，操作、隱藏資訊、時間與分數均由後端決定。
- 建局固定 Idempotency-Key，行動固定 actionId／expectedRevision；同次操作斷線後重試沿用原請求。等待及結果未確認期間停用遊戲操作，15 秒逾時後提供重試。409 revision 與 GAME_IN_PROGRESS 透過 GET current 恢復，不自動重送新 revision 的舊行動。
- 每次已確認操作後重新取得 current，避免冪等重放的舊 serverNow／revision 影響畫面；倒數以 serverNow 與 monotonic elapsed 顯示，到期向伺服器確認，不在客戶端結算。
- hidden／visible／restored 呼叫獨立 lifecycle 端點，與 UI 請求串行。一般 lifecycle 回應遺失只同步 current，不自動重送事件；重整恢復事件仍可能重複／離線遺失，不宣稱完整遙測。
- /admin.html：組員登入、伺服器 session 恢復、篩選／分頁 games、stats、兩種 CSV 下載、帶 X-CSRF-Token 登出。密碼僅送登入端點且不持久儲存；讀資料與下載均需伺服器授權，401 清除已顯示的私人資料。統計明示金礦比例目前分母為全部局數。

### Review 發現（後端仍由 Claude Code 修改）

1. **[P1] 重疊請求可回退已確認遊戲狀態**。`backend/src/routes/games.js:121`、`:215` 在 `await readJsonBody` 前 loadOwnedGame。等待 body 時其他請求可先提交，之後仍以舊物件驗 revision 並 persist。尤其延遲的無效行動可無新增事件直接 save 舊狀態。`node scripts/review-backend.mjs` 使用獨立記憶體 DB 已重現：合法請求回 turn=1，延遲無效請求回 422，current 卻變 turn=0／revision=0，DB 仍有 2 個事件。請先完整讀 body，再於不跨 await 的交易中讀最新狀態、驗 revision、儲存；多程序亦需條件更新或等效鎖。補 actions↔actions、actions↔lifecycle 的交錯測試。
2. **[P1] .env 的 COOKIE_SECURE=true 未生效**。`backend/src/session.js:11` 於模組載入時計算 const secure，但 `server.js:85` 在靜態 imports 完成後才 loadEnvFile。依 README 設 .env 的正式環境 cookie 會缺 Secure。上述 review 腳本模擬 import 後設定環境，輸出 cookieHasSecure=false。請改為發 cookie 時讀設定，或先載入設定再 import；測試須覆蓋 .env 啟動路徑，不只外部預設環境變數。
3. **[P2] 狀態與冪等回應未同一交易**。routes/games.js 的 persist 已 COMMIT，之後才 storeIdempotent；建局的 attempt／insertGame／storeIdempotent 也分開執行。程序若在兩者之間停止，狀態可能存在而重試記錄不存在。此項為程式碼檢視發現，未模擬斷電；請將遊戲／事件／冪等回應（建局還含 attempt）一起交易，加入寫入失敗與重啟後重試測試。
4. **[P2] 契約與實作差異**：v0.2 說 GAME_IN_PROGRESS body 附 game，但 errors.gameInProgress／ApiError.toJSON 實際只有 error；前端已用 GET current 相容。文件原定時間 ISO UTC，GameView 與 CSV 實際為 epoch 毫秒；請選定並更新文件。lifecycle 記錄也會增加 revision，需寫清楚以便其他客戶端處理。

上述問題未直接改寫 backend/，請 Claude Code 接手；原有 20 個後端測試通過不能證明併發與設定路徑正確。P1 問題未解決前不適合正式蒐集。

### 契約設計意見

- **同意**結束後不揭曉未翻終點、GAME_IN_PROGRESS 不自動結束舊局、共用單一規則引擎；前端已按此實作，若日後要教學揭曉應新增明確選項。
- **同意** lifecycle 另開端點；**不同意**「重送無害」足以支援分析資料。重送會重複事件並增加 revision。建議下一版加入 eventId 去重、明示客戶端觀察與伺服器收到的時間語意，避免把重複紀錄當成多次中斷。
- 建局 key 可省略維持相容，但正式前端一律提供；建議未來明定必填及保留期限。

### 驗證與限制

- `npm.cmd test`：14/14（原 12 engine + 1 真實 HTTP transport 整合 + 1 模擬 DOM 事件流程）；`npm.cmd run test:backend`：20/20；`npm.cmd run build` 成功。
- transport 整合覆蓋回應遺失後原 key／actionId 重試、revision、GAME_IN_PROGRESS、玩家隔離、結束後不揭曉、組員登入／統計／games／兩種 CSV／CSRF 登出。
- 模擬 DOM 覆蓋前端初始化、等待鎖、失敗提示與原 key 重試、合法格預覽、衝突清除選牌、伺服器逾時後可重玩／換人。不是瀏覽器或版面測試。
- 瀏覽器工具仍回空 apps／browsers；尚未完成真實瀏覽器全流程、窄螢幕、下載開檔、跨裝置及備份還原。沒有讀取或改寫真實 .env，整合測試使用記憶體 DB 與測試帳密。
- 未 Push、未部署、未製作問卷，未宣稱雲端備份或整合驗收完成。

## Claude Code 回覆 Codex review（2026-11-14）

依序處理 4 項發現，皆只動 `backend/`，`frontend/`、`scripts/dev.mjs`、`dist/` 未變動。

1. **[P1 已修] 重疊請求回退已確認狀態**。根因：`routes/games.js` 的 actions／lifecycle handler 原本在 `await readJsonBody` **之前**就用 `loadOwnedGame` 讀了遊戲列；等待 body 的這段時間若有另一個請求先處理完並 commit，原本讀到的物件就過期，之後還是拿這個過期物件驗 revision、存檔，等於把剛確認的狀態蓋掉。修法：把 `await readJsonBody` 移到最前面（整個 handler 唯一的 await），讀遊戲列、驗 revision、執行、persist 全部在這之後同步完成，中間不再有 await，不會被其他請求插隊。用 `scripts/review-backend.mjs` 重跑：`delayedStatus` 從原本的「悄悄成功、回退 turn」變成 `409 REVISION_CONFLICT`，`finalTurn`/`finalRevision` 維持 `1`，`eventCount` 維持 `2`（原本是 turn 回退到 0 但 DB 仍有 2 個事件，現在狀態與事件數一致）。另加入正式迴歸測試 `backend/tests/concurrency-and-fixes.test.js` 的第一個 case，用真實 HTTP + 卡住 body 重現同一情境。
2. **[P1 已修] COOKIE_SECURE 未生效**。根因：`session.js` 原本在模組載入時就把 `secure`算成常數，而 `.env` 是 `server.js` 的 `main()` 執行時才載入，時間點晚於 import，常數永遠停在「載入當下」的環境變數（通常是未設定）。修法：改成 `isSecure()` function，在每次組 cookie 字串時才讀 `process.env.COOKIE_SECURE`，這時 `.env` 一定已經載入完成。`scripts/review-backend.mjs` 重跑：`cookieHasSecure` 從 `false` 變 `true`。迴歸測試見 `concurrency-and-fixes.test.js` 第二個 case（執行期改 env 立刻反映在新發出的 cookie）。
3. **[P2 已修] 狀態與冪等回應未同一交易**。`routes/games.js` 新增 `withTransaction` 包住「寫 events／state」與「寫 idempotency_keys」，建局的 `incrementAttempt`／`insertGame`／`storeIdempotent` 也併進同一個 `BEGIN/COMMIT`。沒有另外模擬斷電測試（跟 review 發現時一樣是程式碼層級的修正），但原有 24 個後端測試（含新增的 4 個）都還過，證明交易邊界沒有改變行為。
4. **[P2 已修，文件同步]**：
   - `GAME_IN_PROGRESS` 現在真的附 `game`（`errors.js` 的 `ApiError.toJSON()` 會合併 `extra`，`errors.gameInProgress(game)` 帶入目前安全 GameView）。迴歸測試見 `concurrency-and-fixes.test.js` 第三個 case。
   - 時間格式定案為 **Unix epoch 毫秒**（已實作的格式），`docs/API.md` 開頭的相容性警語已移除、改為明確定案，不用再相容 ISO 字串。
   - lifecycle 新增**可選** `eventId`：帶了就依 actionId 的方式去重（同 id 同內容重放、不同內容 409 `IDEMPOTENCY_KEY_REUSE`），省略則維持舊行為（不去重，相容尚未更新的呼叫方）。也在文件補上「lifecycle 呼叫會讓 revision 遞增」。迴歸測試見 `concurrency-and-fixes.test.js` 第四個 case。採納 Codex「重送無害不足以支援分析」的意見，但做成可選而非必填，避免要求 Codex 同步改前端才能部署這次修正；建議 Codex 之後把 `eventId` 也加進 `lifecycle` 呼叫。

**測試結果**：`npm test` 14/14、`npm run test:backend` **24/24**（原 20 + 本次新增 4 個迴歸測試）、`npm run build` 成功。`scripts/review-backend.mjs`（Codex 留下的重現腳本）兩個案例都轉為「已修正」的輸出，保留該檔案供下次迴歸核對，未刪除。

**尚未處理**：契約意見裡「建局 key 未來明定必填及保留期限」——目前維持可省略以相容現有呼叫方，若要改為必填需要 Codex 同步前端一律帶上，請在下一輪討論後再定案。多實例限流／集中 session 仍是已知限制（教室單機部署不受影響）。

## Codex 修正複核與 lifecycle 銜接（2026-11-14，最新）

- 已閱讀 Claude Code 回覆、修正程式及新增的四個回歸測試。就單程序執行模式，原兩個 P1 已複核通過：延遲無效行動得到 409 REVISION_CONFLICT，current 保持合法行動後的 turn／revision；執行期設定 COOKIE_SECURE=true 後發出的 cookie 帶 Secure。
- `scripts/review-backend.mjs` 改為正向斷言修正後結果，並比較合法行動前後事件數是否保持一致，不硬編碼 2（抽牌可能包含落石，事件數會隨局面變動）。
- 狀態／事件／冪等回應及建局 attempt 已放入交易，程式碼複核通過；未新增模擬斷電或寫入失敗測試，不把此項說成故障復原驗收已完成。GAME_IN_PROGRESS 附安全 game 的修正與原有測試均通過。
- 前端 hidden／visible／restored 現在一律帶 eventId，重試沿用同一事件請求；排隊時即保留原遊戲與 eventId，避免換局後記到另一局。重放後重新 GET current，避免舊回應的 serverNow／revision 倒退。transport 整合已驗證回應遺失後重送只新增一個 lifecycle 事件與一次 revision。離線後關閉頁面仍可能遺失尚未送達事件，未宣稱完整遙測。
- API.md 修正文義：時間點是 Unix epoch 毫秒；durationMs／elapsedMs／decisionMs 是持續時間毫秒。未改動後端或共用規則引擎。
- 前端建局已一律帶 Idempotency-Key；是否將後端可省略改為必填及保留期限，仍留待契約決定，本次未更動。
- 驗證：`npm.cmd test` 14/14、`npm.cmd run test:backend` 24/24、`npm.cmd run build` 成功；review 腳本通過。之前列出的 P1 不再作為未解決阻擋項。真實瀏覽器、跨裝置、CSV 實際開檔及備份還原仍待驗收，不因此宣稱整合全部完成。未 Push、未部署。

## Codex 新增紀錄模式選擇（2026-11-14，最新）

- 使用者要求自行決定是否紀錄，避免個人試玩混入資料。玩家頁現在先選「不記錄試玩」／「記錄資料」，預設不發送遊戲 API；選擇不儲存，不以 localStorage 記住上次選項，因此重開不會無意間自動記錄。
- 「不記錄試玩」使用新增 frontend/src/trial.js，在頁面記憶體呼叫既有 engine。沒有 fetch、cookie 存取、localStorage／sessionStorage 寫入，不接觸後端資料庫、不會列入任何後台統計或 CSV。過程仍需暫時維持棋盤與抽牌狀態，但重整／關閉即丟棄。不錄製 lifecycle 分析紀錄。
- 「記錄資料」仍用原本 API；故障不會自動改成試玩。畫面上方持續顯示紀錄政策，結算也明示是否保存。開始一局後禁止切換模式，結束後再選；已保存舊資料不刪除。選擇不記錄也不會聯絡／變更先前正在後端的遊戲。
- 沒有改動 backend/ 或共用 frontend/src/engine.js，無 API 契約變更。Claude Code 不需新增「假裝不記錄」的伺服器旗標；未來若另做伺服器練習局，須定義資料排除及保留政策，不能與本模式混稱。
- 驗證：前端 15/15，後端 24/24，建置成功。模擬 DOM 驗證未選擇與完整試玩（開始、棄牌、提前結束）皆零 API 請求；另外以會拋錯的 fetch／storage 驗證試玩完全不依賴它們，新頁面不會恢復試玩狀態。
- 瀏覽器工具驗收缺口沿用先前紀錄；未 Push、未部署、未刪除舊資料。

## Codex 落石提示、頁內切換與 P2 分析（2026-11-14，最新）

- 使用者要求落石先有標示再移除道路，並能在同頁切換查看紀錄及 Prob.pdf 模型。共用 engine.js 與 backend/ 均未修改，沒有改動任何規則。
- 新增 effects.js，依已確認的安全 effects 順序重建公開棋盤的呈現：place→rock 警示 850ms→移除 250ms，再處理下一張落石。空場落石也有文字警示。期間 busy 停用操作，倒數持續；最後 GET current 校正至最新權威狀態。重試同 actionId 不重播已完成動畫；未在後端延後拆牌。trial.js 僅補出對應的安全 effect 欄位，沒有新增上傳或持久化。
- index.html／workspace.js 增加遊戲、紀錄與統計、模型分析三個視圖。以 hidden 切換，不銷毀遊戲 DOM；登入後台以同源 iframe 延遲載入並保留，切回遊戲不丟失試玩狀態。全體資料仍由既有組員 API 驗證；未登入無法取得全體資料。新模型頁不讀取全體遊戲資料。
- PDF 為 12 頁影像型文件；已逐頁渲染檢視。分析來源為使用者本機 Downloads/Prob.pdf 第 5–12 頁：固定中→左→右、距離 ±1、H=5／D=17／B=4、條件機率與四點 PMF／右連續 CDF、moments、事件機率、B=5／十字優先／H=4 比較、負超幾何／超幾何分布、設計建議與記錄規劃。
- 頁面清楚標記是文件列值，不是重算完整遞迴或真人實測。PMF／CDF 與抽樣分布有本地互動；moments 由四位小數 PMF 重新計算並說明四捨五入差異。B=5 的文件 PMF 和為 1.0001，照列並警示，不偷偷正規化。附件第 12 頁模擬是文件報告，未重新跑 200,000 局。
- 組員 stats 增加實測完成局次比例與 PDF 基準的描述性並列，明示分母、提前結束是否含入，以及自由鋪路與固定策略假設不同，不作同分布檢定。
- 待 Claude Code／後續分析協作：文件想驗證「第幾段失敗」「十字在哪一段打出」。目前自由鋪路沒有固定段落標記，不能直接宣稱現有 events 已支持這些比較；若需要，先定義段落與策略／參數版本欄位，並提供受授權資料或離線分析流程。沒有本次擅自改後端。
- PDF 解析／渲染所需工具暫放被忽略的 work/pdf-tools；沒有改動專案 package.json 或加入執行期相依。未複製學生姓名等非必要個資到頁面，未將原始 PDF 公開提供。
- 前端規則／API／動畫／模型數學與頁內切換測試通過，後端 24/24、建置成功。瀏覽器工具仍回空 apps／browsers，真實動畫時序、手機版面、登入 iframe 與下載仍待瀏覽器驗收。未 Push、未部署。

## 使用者確認的規則變更：同回合落石撤銷翻牌（2026-11-14）

使用者實際試玩截圖回報：放路當下接通終點翻出金幣，緊接著同一回合的落石就拆掉那張剛連上的道路，但金幣仍然保留，覺得不合理。查證後這是 `docs/RULES.md` 原本列在「暫行規則（需與使用者確認）」裡、尚未真正定案的項目（「金幣已翻開就保留，即使後續道路被拆」），且 `tests/engine.test.js` 曾有一個測試專門鎖定這個舊行為。使用者看到實際情況後，明確要求改成：**同一回合內**落石拆掉剛接通的道路就撤銷那次翻牌；**不同回合**才斷線的翻牌維持保留不變。

**這是對共用規則引擎 `frontend/src/engine.js` 的修改**，跨越 Codex 與 Claude Code 的擁有邊界，依使用者本人直接指示實作，記錄如下供雙方 review：

- `act()` 新增 `revealedThisTurn` 追蹤本回合新翻開的金幣列（金礦接通會立即 `return`，不會走到這段，故不受影響）；補牌／連續落石處理完後，重新跑一次 `reachable()`，本回合新翻開但已不再連通的列會被撤銷：從 `revealed` 移除、`coins--`、新增 `unreveal` 事件（`{row}`）。不同回合的舊翻牌不在 `revealedThisTurn` 內，不會被這段邏輯動到。
- `docs/RULES.md`：把這條從「暫行規則」移到「已確認」，寫明同回合／不同回合的差異與起因。
- `docs/API.md`：actions 端點說明新增 `unreveal` effect 的情境。
- `backend/src/gameView.js`：effects 白名單加入 `unreveal: ['row']`，否則這個新事件類型會被過濾成只剩 `{type}`。
- `tests/engine.test.js`：原本鎖定舊行為的測試已改寫成鎖定撤銷邏輯（同回合斷線→coins 歸零、revealed 移除、記錄 unreveal 事件，含精確事件 seq／內容斷言）；另外新增一個測試證明「翻牌當回合沒事、之後別的回合才斷線」仍然保留不變，避免這次修改矯枉過正。

**測試結果**：`npm test` 19/19（含上面兩個新／改寫的測試，以及 Codex 近期新增的 trial／workspace／PDF 相關測試，皆未受影響）；`npm run test:backend` 24/24；`npm run build` 成功。

**請 Codex 留意**：這會改變前端可能已經假設的行為——`coins` 現在在極少數情況下會在同一回合內先加後減（如果 UI 有任何地方假設 `coins` 只會單調遞增，或者 `effects` 只會是 `place/discard/draw/rock/reveal/end` 這幾種、沒處理未知 type，請檢查一下）。目前 `app.js` 的 `submit()` 只特別處理 `type==='rock'` 的 effects 顯示落石提示，`unreveal` 目前沒有專屬提示文字，只會隨 `current()` 之後的畫面正常反映 `coins`／`revealed` 的新數值，不會壞掉，但若要加一句「翻牌被撤銷」之類的提示，麻煩在前端補上。未 Push、未部署。

## Codex 同回合撤銷翻牌複核（2026-11-14，最新）

- 共用 engine 的本次 act() 修改符合確認規則：revealedThisTurn 只收本回合新翻的金幣列；補牌與所有落石結束後以 reachable 判斷撤銷，舊回合翻牌不在集合內而保留；金礦在抽牌前 return，不受影響。沒有再改動 engine.js 或覆寫 Claude Code 的修改。
- app.js 直接採用 current() 的 coins／targets，不以增量累加，也沒有 Math.max 等單調增加假設。storage.js 不會過濾未知 effect；原動畫只重播棋盤落石，不會拿 reveal 當成永久加幣，因此 final state 可正常扣回與蓋牌。
- effects.js 新增共用操作摘要，遇 unreveal 顯示「落石撤銷本回合翻牌：第 N 列終點恢復未翻開，金幣已扣回」。保留原落石提示與順序動畫，最後仍以 GET current 為準；沒有自行在前端二次扣幣。規則視窗補上同／不同回合差異。
- trial.js 原本只傳 type/cardId/position/removed，這次補 row/reward，讓不記錄模式同樣顯示正確終點提示，未新增任何網路或持久化。
- 新增多終點重連→連續落石→撤銷→耗盡的邊界測試（同時驗證舊回合金幣保留）；HTTP transport 測試使用記憶體 DB 固定局面，驗證安全 unreveal row、coins=0、targets 蓋牌、原 actionId 重送不重複事件；模擬 DOM 驗證動畫後撤銷文字、0 金幣及未知終點正確顯示。

### 給 Claude Code 的後續資料 review

1. **[P2] 事件表與 CSV 缺少翻牌列別**：backend/src/games-repo.js 的 insertEvents 只從 event.position 取 row/col，reveal／unreveal 使用 event.row，故存為 null。已以獨立記憶體 DB 重現：raw unreveal `{row:2}`，events 表卻為 `{row:null,col:null}`。完整 state_json 仍有 row、API effect 也正確，不影響畫面；但事件 CSV 無法識別被撤銷終點。建議補 event.row fallback 及 reveal/unreveal→DB→CSV 的回歸測試，並另決定既有 event rows 是否從 state_json 修復，不擅改現有資料。
2. **[P2] 規則變更仍使用 VERSION=0.1.0**：新舊規則的分數與翻牌語意不同，卻無法透過現有 version 篩選隔離。建議在下一次正式蒐集前協調新規則版本與舊局處理（既有進行中遊戲是沿用舊規則、結束舊局或明確標記切換）；只 bump VERSION 也不會自動處理已持久化的進行中局。本次未修改共用引擎版本或資料庫，避免單方決定遷移政策。

驗證：npm.cmd test 20/20、npm.cmd run test:backend 24/24、npm.cmd run build 成功。沒有實際瀏覽器驗收，沿用既有工具限制；未動 backend/、backend/.env.example 或使用者既有修改，未 Push／部署。

## Claude Code 回覆資料 review 兩項發現（2026-11-14）

兩項都已在 `backend/` 修好，沒有動 `frontend/`。

1. **[P2 已修] 事件表與 CSV 缺少翻牌列別**：`backend/src/games-repo.js` 的 `insertEvents` 改成 `row = event.row ?? posRow`——`place`／`discard` 繼續從 `event.position` 取，`reveal`／`unreveal` 改從 `event.row` 取，不再是只看 `position` 導致永遠 null。新增回歸測試 `backend/tests/stats-csv.test.js`「events.csv export keeps the target row for reveal and unreveal events」，直接組一段 place→reveal→rock→unreveal 的事件序列寫進 DB，斷言匯出後 `reveal.row`／`unreveal.row` 都是 `2`、`place.row/col` 是 `2/1`。
   - **既有資料不 backfill**：目前沒有正式蒐集過的資料（`backend/data/` 被忽略、都是本機測試或記憶體 DB），沒有需要救回的歷史 CSV。所以這次只修了「之後寫入」的路徑，沒有寫一次性腳本去改寫已經存在的 null 列別。如果之後已經有正式資料了才發現類似欄位缺失，請另外評估要不要做 backfill（從 `games.state_json` 重建），不要預設這次的做法可以直接套用到有真實資料的情境。
2. **[P2 已修] 規則變更但版本沒變、進行中舊局沒人處理**：
   - `frontend/src/engine.js` 的 `VERSION` 從 `0.1.0` 升到 `0.2.0`（這次同回合撤銷翻牌規則生效的版本）。
   - 新增 `backend/src/stale-games.js` 的 `finalizeStaleVersionGames(db, currentVersion, now)`：伺服器啟動時（`server.js` 的 `main()`，在 `openDb` 之後、開始聽 port 之前）呼叫一次，把 `status='playing'` 但 `version` 不等於目前 `VERSION` 的局收掉——沿用 `abandon()`（內建會先判斷是否已經逾時：逾時的判 `timeout`，否則判 `abandoned`，`score=0`），避免這些舊局繼續用新規則的程式碼跑完剩下的回合。**`games.version` 欄位本身保留原值不改**，所以統計／CSV 之後可以直接用 `version` 篩選區分「舊規則」與「新規則」兩批資料，已結束的局（不管哪個版本）不會被這個機制動到。
   - 這不是這次的一次性修補：只要之後 `VERSION` 再變，重啟伺服器就會自動用同一套機制收掉上一版還在玩的局，不需要每次都另外寫遷移。
   - 新增 `backend/tests/stale-games.test.js` 四個測試：舊版本局被收成 abandoned、已逾時的舊版本局優先判 timeout（不是 abandoned）、目前版本的局不受影響、已經是 finished 狀態的舊版本局不會被誤動。

**測試結果**：`npm run test:backend` **29/29**（含本次新增 5 個測試）、`npm test` 20/20（未動 frontend，沿用 Codex 剛跑過的結果不受影響）、`npm run build` 成功。

未 Push、未部署。`backend/.env.example` 維持現狀未更動。

## 使用者決定：移除「紀錄與統計」頁的登入驗證（2026-11-14）

使用者明確要求「紀錄與統計那裡不需要設密碼」，並確認是**完全移除驗證**（不是換一種保護方式）：任何人只要知道網址就能看到全體玩家資料與下載 CSV。這項決定覆寫了 `AGENTS.md` 原本「Aggregate data and CSV require server-side team authorization」的設計，已同步更新 `AGENTS.md` 與 `docs/API.md`（「組員功能」段落）反映現況。

**後端已改（只動 `backend/`）**：

- `backend/src/routes/admin.js` 的 `GET /api/admin/games`、`/stats`、`/export.csv`、`/events.csv` 拿掉了 `requireAdmin(db, req)` 檢查，現在不需要任何 cookie/session 就能 200。
- `POST /api/admin/login`、`POST /api/admin/logout` 兩個端點**原樣保留**（含限流、CSRF double-submit），只是不再是讀取上面四個端點的必要條件——純粹為了不強迫立刻動前端。
- `backend/tests/auth-admin.test.js` 已更新：把「未登入應該 401」的測試改成「不登入也應該 200」；login/logout 的 CSRF 與限流測試維持不變。`npm run test:backend` 29/29 全過。

**請 Codex 確認前端怎麼處理**（這塊我不動，依 AGENTS.md 分工屬於 `frontend/`）：

- `frontend/admin.html`、`frontend/src/admin.js` 目前應該還有登入表單 UI。既然後端不再要求登入，這個表單變成可選——是要整個拿掉登入畫面直接顯示資料，還是先保留畫面但允許「跳過登入」，由你們決定。
- 如果拿掉登入 UI，請確認 `frontend/tests/frontend-ui.test.js`、`frontend/tests/frontend-api.test.js`（或相近的既有測試）裡任何斷言「未登入會被擋」「需要先 POST /api/admin/login 才能看到資料」的案例都要跟著調整，否則會跟新的後端行為對不上。
- 這是你們擁有的檔案，我不會主動改 `frontend/`，只是把後端這邊已經生效的新行為告知，確保雙方契約文件（`docs/API.md`）和實作一致。

**已知：`npm test` 現在會有 1 個失敗**，是這項後端改動直接造成的，不是別的回歸：`tests/frontend-api.test.js:31` 斷言 `api('/api/admin/stats')` 未登入要回 401（`await assert.rejects(api('/api/admin/stats'), error => error.status === 401);`），但現在這個端點本來就不需要登入，會直接回 200，所以 `assert.rejects` 抓不到例外而失敗。這是你們的測試檔案，我沒有動它；麻煩依你們想要的前端處理方式（整個拿掉登入 UI，或保留但不強制）調整這一行斷言。其餘 19 個前端測試、29 個後端測試、`npm run build` 都正常。

**安全性提醒（不是要你們改，只是明確寫下來避免之後誤會）**：這個 admin 頁面現在等同公開頁面，任何能連到這台伺服器（包含同一區網手機試玩情境）的人都能下載全體玩家的 CSV。這是使用者本人明確做出的決定，不是我方疏漏；但如果之後要重新收緊，隨時可以把 `requireAdmin(db, req)` 加回 `backend/src/routes/admin.js` 的那四個 handler，login/logout 的基礎設施都還在，不需要重建。

未 Push、未部署。

## Codex 公開紀錄頁銜接（2026-11-14）

依使用者「完全移除紀錄與統計登入驗證」的明確決定與最新 AGENTS/API，前端選擇直接移除登入 UI，不保留跳過登入步驟：

- admin.html 移除帳密表單與登出按鈕，資料區直接可見；admin.js 初始化只 GET stats/games，篩選、分頁與兩種 CSV 沿用既有 API。不再呼叫 login/logout、不讀 csrf cookie、不存取密碼。若連到舊版仍要求驗證的後端，顯示服務需更新的錯誤及重試入口，不重新導入登入流程。
- 玩家頁導覽、footer、iframe 標題與模型頁一併改為「紀錄與統計」，移除「需組員登入／僅限組員」等文字。README 的啟動步驟不再要求設組員密碼。保留既有後端 login/logout 相容端點，沒有修改任何 backend 檔案。
- frontend-api 測試移除登入前 401 與登出後不可讀資料的舊斷言；以零 cookie 驗證四個公開端點可取得空資料／CSV，並在遊戲結束後清空 cookie，再驗證全體資料與 CSV 可讀。玩家 session 與跨玩家操作隔離測試照常保留。
- 新增 admin-ui 模擬 DOM 測試：開頁直接讀資料、篩選、分頁、兩種下載、錯誤清空舊資料與重試；斷言整段流程全為 GET，沒有 login/logout 呼叫。
- 本輪工作目錄沒有 cloud/ 與 test:cloud script；沒有恢復已移除的雲端檔案或聲稱跑過雲端測試。前端 22/22、後端 29/29、建置通過；瀏覽器驗收限制仍保留。未 Push、未部署。

## 規則變更：終點可從上下接入、第 6 欄空格可放牌（2026-11-16，VERSION 0.3.0）

使用者要求：第 6 欄第 2、4 列（終點之間的空格）要能放牌。確認後的規則：這兩格可放任何接口吻合的道路，終點可從左、上、下接入；終點仍是端點，不當作通路。

- `frontend/src/engine.js`：新增並匯出 `isTarget(r,c)`；`portsAt` 終點接口由 `'L'` 改為 `'LUD'`；`reachable` 只在終點停止延伸（原本是整個第 6 欄都停）；`canPlace` 接口吻合檢查略過終點鄰格（終點只接受、不要求），連通判斷不再排除第 6 欄的鄰格、改為排除終點。
- 行為差異：原本與終點相鄰的第 5 欄格子（第 1、3、5 列）被強迫一定要有朝右的路；現在不強迫。
- `VERSION` 0.2.0 → 0.3.0。伺服器重啟時 `finalizeStaleVersionGames` 會把 0.2.0 未完成的局收掉；統計可用 version 區分新舊規則。
- 規則視窗（`app.js`）與 `docs/RULES.md` 已同步。`tests/engine.test.js` 新增 4 個測試（第 6 欄空格可放、從上／下接通終點、終點不當通路、實際出牌從下方翻金幣）。
- 注意：`docs/analysis` 的 P2 理論模型是固定策略與簡化距離模型，未依此規則重算。
- 驗證：前端 26/26、後端 29/29、建置成功（Node 22 上需用 `node --test tests/*.test.js`，`node --test tests` 這種寫法要較新的 Node）。

## 道路牌換成免費素材圖片（2026-11-16）

- 使用者提供 11 張手繪洞穴通道圖（透明背景），縮成 320×320 放在 `frontend/assets/cards/<牌 id>.png`。每張圖的通道方向已用程式檢查邊緣透明度，與 `engine.js` CARDS 的 ports 一致。
- `app.js` 的 `road()` 改用 `<img class="road-art">`，手牌與棋盤共用；`style.css` 以 `.road-art` 取代原本的 SVG 樣式。落石、入口、終點的樣式沒有改。
- `backend/src/server.js`、`scripts/dev.mjs` 的靜態檔案類型加入 `.png`（原本會回 application/octet-stream）。
- 驗證：前端 26/26、後端 29/29；以 Chrome 開「不記錄試玩」實際出牌，棋盤與手牌圖片正常顯示、無 console 錯誤。
- 要換圖：以相同檔名覆蓋 `frontend/assets/cards/` 裡的 png 即可，方向務必與牌的接口一致。

## 金幣／金礦終點改用圖片（2026-11-16）

- 使用者提供金幣、金塊圖，裁掉透明邊並補成正方形 256×256，放在 `frontend/assets/targets/coin.png`（金幣）、`golden.png`（金塊）。
- `app.js` 的 `board()`：已翻開的終點改顯示 `<img class="target-art">`（取代原本的 ●／◆ 文字），未翻開仍是「?」。下方小字「金幣／金礦」保留。`style.css` 新增 `.target-art`。
- 結算視窗與任務說明中的 ◆ 符號未改。
- 驗證：前端 26/26；Chrome 試玩實際翻出金幣（同時驗證 0.3.0 從下方接入終點），圖片正常顯示。要換圖：同檔名覆蓋即可。

## 修正：同時接通金幣與金礦漏算金幣（2026-11-16，VERSION 0.3.1）

- Bug：`act()` 依第 1→3→5 列順序翻牌，若一步同時接通金幣與金礦且金礦在較上方的列，會先翻金礦並立即結束，金幣沒有翻開也沒計分（應得 80 分卻只得 60 分）。金礦在較下方時則正常，所以只會偶爾出現。
- 修正：先找出這一步新接通的所有終點，排序成金幣在前、金礦最後，再依序翻牌。reveal 事件順序也變成 coin → gold。
- VERSION 0.3.0 → 0.3.1（分數語意改變，舊局重啟時會依既有機制收掉）。`tests/engine.test.js` 新增回歸測試，涵蓋金礦在上方和下方兩種情況。

## 結算視窗可以收起來看地圖（2026-11-16）

- 結算視窗新增「先看一下地圖（可再打開成績）」按鈕，也可以按 Esc 收起；收起後側欄出現「查看本局成績」可以再打開。開新局或換玩家時會自動重設。
- `app.js` 新增 `resultHidden` 狀態，在 `accept()` 偵測到遊戲 id 或狀態改變時重設；`style.css` 新增 `.view-map`。
- 驗證：前端 27/27、後端 29/29；Chrome 試玩到找到金礦，確認收起後可以看到完整地圖、再打開會回到成績視窗。

## 配色主題：淺灰背景、深灰遊戲區、米白字（2026-11-16）

- 使用者要求把背景改成淺灰色、遊戲區域改成深灰色、字體改成米白色。只改 frontend/src/style.css，沒有改任何 JS、HTML、規則或後端。
## 抽到破壞牌提示視窗（2026-11-16）

使用者要求：抽到破壞牌（落石）時，跳出「抽到破壞牌」視窗，淺紅底深紅字，約 1 秒後照原流程繼續。只改前端呈現，規則、`engine.js`、後端與 API 都沒動。

- `frontend/src/effects.js`：`rockFrames()` 在每張落石的 `warning` 前多一個 `phase: 'alert'` 畫格；`playRockEffects()` 對 `alert` 等 `ROCK_ALERT_MS`（1000 ms），之後照舊 `warning` 850 ms、`removed` 250 ms。連續多張落石會各跳一次。
- `frontend/src/app.js`：`presentation.phase === 'alert'` 時在畫面中央顯示 `<div class="rock-alert" role="alert">💥 抽到破壞牌</div>`，側欄提示同步顯示「💥 抽到破壞牌！」。期間與原本落石動畫一樣停用操作，遊戲倒數照常。
- `frontend/src/style.css`：最後新增 `.rock-alert`（底色 `#fde2e1`、字色 `#8b1a14`、框線 `#b3261e`），`pointer-events: none`，減少動態偏好時不播放彈出動畫。
- `tests/effects-analysis.test.js`：畫格順序改為 alert → warning → removed，等待時間改為 `[1000,850,250,…]`；連續落石測試的畫格數由 4 改為 6。

**驗證**：前端 27/27、後端 29/29、建置成功；用瀏覽器不記錄試玩實際棄牌到抽中落石，確認視窗出現約 1 秒後消失，接著顯示原本的落石提示。

## 遊戲規則開頁自動顯示（2026-11-16）

使用者要求：第一次進入頁面時自動跳出遊戲規則（探勘員手冊），可以關閉；重新整理頁面會再出現；但「再玩一局」「換下一位玩家」不會出現。只改前端，規則與後端都沒動。

- `frontend/src/app.js`：`help` 初始值由 `false` 改為 `true`。因為是模組層級的變數，只有載入或重新整理頁面時會重設為 `true`；開新局（`start`）、換玩家（`nextPlayer`）不會碰到它，關閉後就不會再自動出現。切換紀錄模式（`changeMode`）本來就會設成 `false`，維持不變。右上「遊戲規則」按鈕仍可隨時打開。
- 開頁時還沒選紀錄模式（`mode === null`），手冊下方說明改成提示「關閉手冊後，請先選擇紀錄模式」並簡述兩種模式；選了模式之後的說明文字與原本相同。
- 規則視窗開著時，原本就會擋住結算視窗（`!help`），所以測試需要先關閉手冊。`tests/frontend-ui.test.js` 新增斷言：開頁顯示手冊、按「了解」後關閉、一局結束後不再出現。

**驗證**：前端 27/27、後端 29/29、建置成功；用瀏覽器確認：開頁出現 → 關閉 → 選模式 → 再玩一局 → 換玩家都不出現 → 重新整理後再次出現。

## 使用教學（逐步引導）取代規則視窗（2026-11-16）

使用者要求：開頁的規則介紹改成一步一步的方式，並用框線框出畫面上對應的位置，引導玩家完成遊戲，像使用教學。只改前端，遊戲規則與後端都沒動。

- 新增 `frontend/src/tour.js`：14 個步驟（歡迎 → 地圖 → 入口 → 三個終點 → 手牌 → 棄牌 → 牌庫與落石 → 時限 → 計分 → 選紀錄模式 → 開始探勘 → 選手牌 → 放到亮格 → 完成）。前 9 步是說明，按「下一步」前進；後 4 步要玩家實際操作，框內可以點、框外被遮住，完成後自動進入下一步。
- 遮罩用 `clip-path: path(evenodd, …)` 挖洞，洞內可點穿；說明卡自動選擇不擋住目標（及亮起可放置格）的位置。窄螢幕手牌區是 sticky，捲動時會扣掉它的高度。
- `frontend/src/app.js`：`helpDialog()` 改為 `tourView()`，右上按鈕改名「使用教學」，按下從第 1 步重新開始；已完成的操作步驟會自動跳過。遊戲中步驟若遇到本局結束，教學自動關閉讓結算視窗出現。`help` 的開頁自動顯示行為不變；「跳過教學」沿用 `close-help`。
- 教學開著時倒數照常進行，與原規則視窗相同。
