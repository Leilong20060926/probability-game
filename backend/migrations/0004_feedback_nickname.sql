
ALTER TABLE player_feedback ADD COLUMN player_nickname TEXT;

UPDATE player_feedback
SET player_nickname = (
  SELECT games.player_nickname
  FROM games
  WHERE games.id = player_feedback.first_game_id
    AND games.player_id = player_feedback.player_id
);
