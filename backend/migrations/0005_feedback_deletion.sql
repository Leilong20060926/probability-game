
CREATE TABLE IF NOT EXISTS player_feedback_deletions (
  player_id TEXT PRIMARY KEY REFERENCES players(id),
  deleted_at INTEGER NOT NULL
);
