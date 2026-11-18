CREATE TABLE player_feedback (
  player_id TEXT PRIMARY KEY REFERENCES players(id),
  first_game_id TEXT NOT NULL,
  first_game_ended_at INTEGER NOT NULL,
  difficulty TEXT NOT NULL CHECK (difficulty IN ('easy', 'medium', 'hard')),
  replay INTEGER NOT NULL CHECK (replay IN (0, 1)),
  enjoyment INTEGER NOT NULL CHECK (enjoyment BETWEEN 1 AND 5),
  submitted_at INTEGER NOT NULL
);

CREATE INDEX idx_player_feedback_time
ON player_feedback(submitted_at DESC, player_id);