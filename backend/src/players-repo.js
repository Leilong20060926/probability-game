import { randomUUID } from 'node:crypto';

export function createPlayer(db, now) {
  const id = randomUUID();
  db.prepare(
    'INSERT INTO players (id, attempt_counter, created_at) VALUES (?, 0, ?)',
  ).run(id, now);
  return getPlayer(db, id);
}

export function getPlayer(db, id) {
  return db.prepare('SELECT * FROM players WHERE id = ?').get(id) || null;
}

export function previewNextAttempt(player) {
  return player.attempt_counter + 1;
}

export function incrementAttempt(db, playerId) {
  db.prepare(
    'UPDATE players SET attempt_counter = attempt_counter + 1 WHERE id = ?',
  ).run(playerId);
  return getPlayer(db, playerId).attempt_counter;
}
