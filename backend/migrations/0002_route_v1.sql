-- route-v1（三地圖路段版）。
-- games.gold_row 原本 NOT NULL，是舊格子版的「金礦在第幾列」；路段版沒有這個概念，
-- 不能把「金礦在第幾張地圖」硬塞進去。依 SQLite 建議的重建程序把它改成可為 NULL，
-- 另加 ruleset 等欄位。舊資料全數保留，ruleset 標 'grid'，不重標成新規則。
-- （db.js 的 migrate() 在重建期間關閉外鍵檢查，COMMIT 前跑 foreign_key_check。）

CREATE TABLE games_new (
  id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL REFERENCES players(id),
  attempt INTEGER NOT NULL,
  ruleset TEXT NOT NULL DEFAULT 'grid',
  version TEXT NOT NULL,
  config_id TEXT,
  revision INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL,
  mode TEXT NOT NULL,
  status TEXT NOT NULL,
  reason TEXT,
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  score INTEGER NOT NULL DEFAULT 0,
  coins INTEGER NOT NULL DEFAULT 0,
  turn INTEGER NOT NULL DEFAULT 0,
  gold_row INTEGER,
  gold_map_index INTEGER,
  map_index INTEGER,
  map_sequence TEXT,
  device_type TEXT,
  config_json TEXT,
  state_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

INSERT INTO games_new (
  id, player_id, attempt, ruleset, version, revision, source, mode, status, reason,
  started_at, ended_at, score, coins, turn, gold_row, device_type, state_json,
  created_at, updated_at
)
SELECT
  id, player_id, attempt, 'grid', version, revision, source, mode, status, reason,
  started_at, ended_at, score, coins, turn, gold_row, device_type, state_json,
  created_at, updated_at
FROM games;

DROP TABLE games;
ALTER TABLE games_new RENAME TO games;

CREATE INDEX idx_games_player ON games(player_id, created_at);
CREATE INDEX idx_games_status ON games(status);
CREATE INDEX idx_games_ruleset ON games(ruleset, version, config_id);

-- 事件：路段版的分析欄位直接成為欄位（CSV 不需要再從 state_json 拆）。
ALTER TABLE events ADD COLUMN map_index INTEGER;
ALTER TABLE events ADD COLUMN map_id INTEGER;
ALTER TABLE events ADD COLUMN pos TEXT;
ALTER TABLE events ADD COLUMN branch TEXT;
ALTER TABLE events ADD COLUMN a INTEGER;
ALTER TABLE events ADD COLUMN action TEXT;
ALTER TABLE events ADD COLUMN segment TEXT;
ALTER TABLE events ADD COLUMN pay_h INTEGER;
ALTER TABLE events ADD COLUMN pay_v INTEGER;
ALTER TABLE events ADD COLUMN pay_b INTEGER;
ALTER TABLE events ADD COLUMN pay_x INTEGER;
ALTER TABLE events ADD COLUMN hand_h INTEGER;
ALTER TABLE events ADD COLUMN hand_v INTEGER;
ALTER TABLE events ADD COLUMN hand_b INTEGER;
ALTER TABLE events ADD COLUMN hand_x INTEGER;
ALTER TABLE events ADD COLUMN deck_h INTEGER;
ALTER TABLE events ADD COLUMN deck_v INTEGER;
ALTER TABLE events ADD COLUMN deck_b INTEGER;
ALTER TABLE events ADD COLUMN deck_x INTEGER;
ALTER TABLE events ADD COLUMN deck_r INTEGER;
ALTER TABLE events ADD COLUMN result TEXT;
