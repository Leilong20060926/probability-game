-- Per-game display name snapshot. Historical anonymous records remain NULL.
ALTER TABLE games ADD COLUMN player_nickname TEXT;
