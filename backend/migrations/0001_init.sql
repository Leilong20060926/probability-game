-- 初始結構：玩家、session、遊戲、事件、冪等鍵。
-- state_json 內含完整引擎物件（含 deck、goldRow），僅伺服器讀寫，絕不外傳。

CREATE TABLE players (
  id TEXT PRIMARY KEY,
  attempt_counter INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE player_sessions (
  id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL REFERENCES players(id),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX idx_player_sessions_player ON player_sessions(player_id);

CREATE TABLE admin_sessions (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  csrf_token TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE games (
  id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL REFERENCES players(id),
  attempt INTEGER NOT NULL,
  version TEXT NOT NULL,
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
  gold_row INTEGER NOT NULL,
  device_type TEXT,
  state_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX idx_games_player ON games(player_id, created_at);
CREATE INDEX idx_games_status ON games(status);

CREATE TABLE events (
  game_id TEXT NOT NULL REFERENCES games(id),
  seq INTEGER NOT NULL,
  turn INTEGER NOT NULL,
  type TEXT NOT NULL,
  elapsed_ms INTEGER NOT NULL,
  decision_ms INTEGER,
  card_id TEXT,
  row INTEGER,
  col INTEGER,
  removed TEXT,
  reward TEXT,
  hand_count INTEGER,
  deck_count INTEGER,
  reason TEXT,
  score INTEGER,
  PRIMARY KEY (game_id, seq)
);

CREATE TABLE idempotency_keys (
  scope TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  status_code INTEGER NOT NULL,
  response_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (scope, owner_id, key)
);
