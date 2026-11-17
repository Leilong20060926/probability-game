# 前後端介面（v0.1 提案與 v0.2 定案）

下方 v0.1 保留提案背景；目前已有後端及 API 前端，衝突處以「契約定案 v0.2」為準。Codex review 與待修事項見 HANDOFF.md 最新段落。JSON 駝峰命名，持續時間為毫秒，列欄使用 0-based。**時間定案：`startedAt`、`endedAt`、`deadlineAt`、`serverNow` 與 CSV 對應的時間點為 Unix epoch 毫秒（`Date.now()` 數值），不是 ISO 字串；`durationMs`、`elapsedMs`、`decisionMs` 為持續時間毫秒，不是 epoch 時間點。** v0.1 原提案的「ISO UTC」已不適用，以此為準。

## 分工與信任邊界

- 後端擁有真正遊戲狀態、洗牌、金礦位置、計時與計分。前端 engine 是離線試玩與對照測試的實作。
- 正式遊戲不可把未抽牌庫與金礦位置回傳給瀏覽器。不得接受客戶端聲稱的 score 或 goldRow 作為可信結果。
- local 模式紀錄不可偽裝 server 模式真人紀錄；若提供匯入，標記 `unverified_local`。
- 同一匿名玩家的能力憑證應由後端設定 HttpOnly、SameSite cookie（正式環境 Secure）。UUID 只是識別碼，不是授權。
- ~~管理 API 必須驗證組員 session~~（2026-11-14 使用者決定移除）：`GET /api/admin/games`、`/stats`、`/export.csv`、`/events.csv` 現在不需要登入即可讀取，任何知道網址的人都能看到全體玩家資料並下載 CSV。`POST /api/admin/login`/`logout` 端點仍保留（相容既有前端流程），但不再是讀取資料的必要條件。這項決定覆寫了本文件與 AGENTS.md 先前的「server-side team authorization」設計，細節見 `docs/HANDOFF.md`。

## 玩家 API（建議同源 /api）

### POST /api/players

建立匿名玩家 session；已存在時可返回既有玩家。

回應：`{ playerId, nextAttempt }`。

### POST /api/players/switch

明確更換共用設備玩家、換發 cookie，回應同上。不得因此讓新玩家取得上一位的私人歷史紀錄。

### POST /api/games

標頭 `Idempotency-Key`：客戶端 UUID。回應 201 為安全 GameView。版本與正式參數由伺服器決定；不得允許玩家調難度而未記錄。

### GET /api/games/current

恢復同一 session 的進行中／最近一局。回傳 GameView 或 204。伺服器按時間結算逾時，不能依賴客戶端送出 end。

### POST /api/games/:id/actions

內容：

`{ actionId, expectedRevision, type: "place"|"discard"|"abandon", handIndex?, row?, col? }`

伺服器原子驗證及處理：出牌→揭終點→金礦結束，否則補牌與連續落石→耗盡結算。**2026-11-14 規則變更**：若同一回合的落石（補牌階段）拆掉了剛接通的道路，該次翻牌會被撤銷（金幣數扣回、`revealed` 移除該列），`effects` 會包含 `{type:"unreveal", row}`；這只影響同回合內的情況，不同回合才斷線的翻牌仍保留不變。詳見 `docs/RULES.md` 的確認規則與 `frontend/src/engine.js` 的 `act()`。

同一 actionId 重試不得再執行；不同 body 重用 key 應拒絕。expectedRevision 衝突回 409 與最新安全狀態，避免多分頁重複出牌。無效行動不消耗卡牌。

錯誤格式：`{ error: { code, message } }`，不帶內部資料。

回應：`{ game: GameView, effects: [{ type, ...safeFields }] }`。

### GameView

以下是結構示意，不是可直接解析的 JSON：

```text
{
  id, playerId, attempt, version, revision,
  mode: "server", source: "human",
  config: {
    rows: 5,
    cols: 6,
    handSize: 5,
    seconds: 300,
    rocks: 4
  },
  status: "playing"|"finished",
  startedAt, deadlineAt, serverNow, endedAt,
  hand: ["horizontal", ...],
  deckRemaining: 17,
  deckCounts: { cross: 2, horizontal: 1, ..., rock: 4 },  // 牌庫各種牌剩幾張，不含順序
  board: [{ row, col, cardId }],
  targets: [
    { row, revealed: false }
    |
    { row, revealed: true, reward: "coin"|"gold" }
  ],
  coins, turn, score,
  reason: null|"gold"|"timeout"|"exhausted"|"abandoned"
}
```

前端需以 serverNow 校正倒數，斷線時暫停送出行動並提示，不能悄悄切到另一局本機遊戲。

## 組員 API

- POST /api/admin/login：限速、伺服器驗證、設定組員 session；選 cookie 時加入 CSRF 防護。
- POST /api/admin/logout：撤銷 session。
- GET /api/admin/games：分頁與 version/source/mode/status 篩選。
- GET /api/admin/stats：同篩選，回傳樣本數、結束原因、通關率、得分計數、時間統計；空資料不得產生 NaN。分清局數與不重複玩家數。
- GET /api/admin/export.csv：同篩選，UTF-8，必要時 BOM；正確跳脫並避免試算表公式注入。
- GET /api/admin/events.csv：逐事件匯出，使用 gameId 關聯每局。

## 契約定案 v0.2（Claude Code 回覆，2026-11-14）

後端已依下列定案實作並通過測試（見 `docs/HANDOFF.md` 的啟動與測試紀錄）。以上 v0.1 提案內容仍維持不變，本節是對「待確認」清單的逐項回覆；衝突處以本節為準。

### 技術選擇

- 後端只用 Node 內建模組（`node:http`、`node:sqlite`、`node:crypto`），不引入任何 npm 套件，延續 `AGENTS.md` 的 no-runtime-dependency 原則。需要 Node ≥ 22.5（`node:sqlite` 穩定版門檻），`package.json` 的 `engines.node` 已調整。
- 後端**直接 import** `frontend/src/engine.js` 當唯一的規則來源（`backend/src/engine-adapter.js`），不複製一份規則邏輯。這是後端對前端目錄的唯讀相依：**往後修改 `frontend/src/engine.js` 等於同時修改後端規則**，請 Codex 修改前先知會，雙方一起 review 對應的 `tests/engine.test.js` 與 `backend/tests/`。
- 後端 `server.js` 同時服務 `/api/*` 與 `frontend/` 靜態檔，玩家頁與 API 同源，不需要 CORS，cookie 可直接用。`scripts/dev.mjs`（純前端開發伺服器）不受影響、未修改。

### 安全狀態（回覆「安全狀態」待確認項）

- GameView 永不包含 `deck`（牌庫順序）、`goldRow`。2026-11-16 起另有 `deckCounts`：只給牌庫中各種牌（含 `rock`）尚未抽出的數量，不給順序；這是玩家本來就能靠記牌推算的資訊。`targets` 未揭曉時只有 `{row, revealed:false}`；**即使遊戲已結束（timeout/exhausted/abandoned）也不揭露未翻的終點**，只有玩家實際翻到的才會出現 `reward`。這是刻意選擇（保留機率遊戲的不確定性），Codex 若需要「結束後揭曉全部終點」的教學用途，請在 HANDOFF 提出，屆時會是另一個欄位（例如 `revealAllOnFinish`），不會改動現有欄位語意。
- `board` 只含已放置道路（`{row, col, cardId}`），入口與固定終點格不在其中，沿用前端 `app.js` 既有的「依 row/col 規則畫出入口與終點」畫法。

### 冪等與衝突（回覆「冪等與衝突」待確認項）

- `POST /api/games` 的 `Idempotency-Key`（可省略，省略則不提供重放保護）與 `POST /api/games/:id/actions` 的 `actionId`（必填）採同一機制：伺服器記錄 `(scope, ownerId, key) → (request 雜湊, 狀態碼, 回應內容)`；同 key 同內容重放回同一結果；同 key 不同內容回 `409 IDEMPOTENCY_KEY_REUSE`。
- 已有進行中遊戲時再次 `POST /api/games`（未用重放 key）：回 `409 GAME_IN_PROGRESS`，body 附目前安全 GameView；建立新局前請先呼叫 `GET /api/games/current` 或對舊局送出 `abandon`。
- `expectedRevision` 與伺服器目前 revision 不符：回 `409 REVISION_CONFLICT`，body 為 `{ error, game }`（`game` 為最新安全 GameView），而不是單純的 error 物件。

### 計時與順序

- 每次 `GET /api/games/current` 或 `POST .../actions`、`POST .../lifecycle`，伺服器一律先以當前時間跑逾時判定；逾時優先於玩家送出的任何行動（包含到期後才送達的 `abandon`，結果仍是 `timeout` 不是 `abandoned`）。

### 背景事件（回覆「背景事件」待確認項）

- 新增 `POST /api/games/:id/actions` 之外的端點：

  ```
  POST /api/games/:id/lifecycle
  { "type": "hidden" | "visible" | "restored", "eventId"?: string }
  ```

  行為：先跑逾時判定，再呼叫對應的生命週期記錄；回應格式與 actions 相同（`{ game, effects }`）。**這個呼叫也會讓 `revision` 遞增**（寫入了新事件），呼叫方請以回應內的 `revision` 為準，不要假設只有 actions 才會改變它。

  **v0.2.1 修正**：先前這裡寫「重送無害」不準確——重送若沒有去重，會在 events 表留下重複的 `hidden`/`visible`/`restored` 紀錄，影響分析（Codex review 的契約意見）。現在 `eventId`（客戶端產生的字串）是**可選**欄位：帶了就依 actionId 的方式去重（同 `eventId` 同內容重放同一回應；同 `eventId` 不同內容回 `409 IDEMPOTENCY_KEY_REUSE`）；省略則維持舊行為（不去重，相容尚未更新的呼叫方）。建議 Codex 之後的呼叫一律帶上 `eventId`。

### 組員功能（回覆「組員功能」待確認項）

- Cookie session：玩家與組員分離（`mine_player_session`、`mine_admin_session`），皆為伺服器產生的隨機 id，`HttpOnly`、`SameSite`（玩家 Lax、組員 Strict）。正式環境請設定 `COOKIE_SECURE=true`（需要 HTTPS）。
- 組員登入：`POST /api/admin/login { username, password }`，依 IP+帳號限流（15 分鐘內 5 次錯誤即鎖定）。成功回應 `{ username, csrfToken }`，並另外發一個非 HttpOnly 的 `mine_admin_csrf` cookie（雙重送出模式）。
- `POST /api/admin/logout` 需要在 header 帶 `X-CSRF-Token`，與 cookie 相符才會登出；不符回 `403 FORBIDDEN`。
- **2026-11-14 定案（使用者明確決定，覆寫上面的「組員 session」設計）**：`GET /api/admin/games`、`GET /api/admin/stats`、`GET /api/admin/export.csv`、`GET /api/admin/events.csv` 已移除 `requireAdmin` 檢查，**不需要登入即可讀取**，知道網址就能看到全體玩家資料與下載 CSV。登入/登出端點仍保留、仍會簽發/撤銷 `mine_admin_session`，但不再是讀取這四個端點的必要條件——保留純粹是相容既有前端呼叫，之後前端的登入畫面要不要留由 Codex 決定。各端點支援的 `version`/`source`/`mode`/`status`/`reason` 篩選與 `games` 的 `page`/`pageSize`（預設 50，上限 200）不變。
- `stats` 空資料時 `games`/`players`/`finished` 為 0，`goldFinishRate`/`avgScore`/`avgDurationMs` 在無資料時回 `null`（SQL `AVG`/除以零皆不產生 NaN）；`games` 計局數、`players` 為 `COUNT(DISTINCT playerId)`。

### 錯誤格式

統一 `{ error: { code, message } }`（revision 衝突額外附 `game`）。代碼表：

| code | 狀態碼 | 情境 |
| --- | --- | --- |
| `UNAUTHORIZED` | 401 | 未帶有效玩家／組員 session |
| `FORBIDDEN` | 403 | CSRF token 不符 |
| `NOT_FOUND` | 404 | 遊戲不存在或不屬於目前玩家 |
| `BAD_REQUEST` | 400 | 缺少必填欄位或型別錯誤 |
| `INVALID_ACTION` | 422 | 落子/棄牌不合法（未消耗卡牌或回合） |
| `GAME_IN_PROGRESS` | 409 | 已有進行中遊戲，未使用重放 key |
| `REVISION_CONFLICT` | 409 | `expectedRevision` 過舊 |
| `IDEMPOTENCY_KEY_REUSE` | 409 | 同一 key／actionId 帶不同內容重送 |
| `RATE_LIMITED` | 429 | 組員登入嘗試過多 |
| `PAYLOAD_TOO_LARGE` | 413 | request body 超過 64KB |

## 資料欄位

Games：

gameId、playerId、attempt、version、完整 config、source、mode、startedAt、endedAt、status、reason、durationMs、turns、score、coins、goldRow（僅後台）、裝置類別、是否中斷／恢復。

Events：

gameId、seq（局內唯一遞增）、turn、type、elapsedMs、decisionMs（place/discard）、cardId、row/col、移除位置、翻牌結果、手牌數／牌庫數。事件、最終結果與對應的冪等重放紀錄（`Idempotency-Key`／`actionId`／`eventId`）須在同一交易內寫入；v0.2 實作曾經分開寫入（Codex review P2），已修正為共用交易。

時間定義：

整局從按開始到結束；每回合從開始或上一合法行動完成，到本次合法 place/discard。包含思考及背景時間，不稱「純思考時間」。另記分頁隱藏／恢復事件以便分析排除。

持久化：

資料庫請使用持久磁碟或雲端服務，加入遷移與備份說明。需要驗證重啟仍在、兩裝置集中、重試不重複、匯出開檔核對。後端框架與資料庫由 Claude Code 提案。

規則版本與進行中舊局（2026-11-14 定案）：

`frontend/src/engine.js` 的 `VERSION` 每次規則有實質變更（像同回合撤銷翻牌這種會改變分數／事件語意的變更）就要 bump；每局建立時的 `version` 欄位凍結，之後不會被改寫，統計／CSV 可以直接用 `version` 篩選區分不同規則下的資料。伺服器啟動時會呼叫 `backend/src/stale-games.js` 的 `finalizeStaleVersionGames`，把 `status=playing` 但 `version` 不是目前版本的局收掉（已逾時判 `timeout`，否則判 `abandoned`），避免舊局用新規則的程式碼繼續跑完剩下的回合。這個機制是通用的，每次 `VERSION` 再變動都會自動套用，不需要每次另外寫一次性遷移。
