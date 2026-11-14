# 協作交接

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
