// 遊戲持久化：state_json 是單一事實來源（含 revision、deck、goldRow 等隱藏資訊）。
// DB 欄位是用來查詢/篩選的鏡像，每次寫入都同步更新，不單獨信任。
function toRecord(row) {
  if (!row) return null;
  return JSON.parse(row.state_json);
}

export function insertGame(db, record, deviceType, now) {
  record.mode = 'server';
  record.revision = 0;

  db.prepare(`
    INSERT INTO games (
      id, player_id, attempt, version, revision, source, mode, status, reason,
      started_at, ended_at, score, coins, turn, gold_row, device_type, state_json,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    record.id, record.playerId, record.attempt, record.version, record.revision,
    record.source, record.mode, record.status, record.reason ?? null,
    record.startedAt, record.endedAt, record.score, record.coins, record.turn,
    record.goldRow, deviceType ?? null, JSON.stringify(record), now, now,
  );

  return record;
}

export function getGame(db, id) {
  return toRecord(db.prepare('SELECT * FROM games WHERE id = ?').get(id));
}

export function getPlayingGameForPlayer(db, playerId) {
  return toRecord(db.prepare(
    "SELECT * FROM games WHERE player_id = ? AND status = 'playing' ORDER BY created_at DESC LIMIT 1",
  ).get(playerId));
}

export function getLatestGameForPlayer(db, playerId) {
  return toRecord(db.prepare(
    'SELECT * FROM games WHERE player_id = ? ORDER BY created_at DESC LIMIT 1',
  ).get(playerId));
}

export function saveGame(db, record, now) {
  db.prepare(`
    UPDATE games SET
      revision = ?, status = ?, reason = ?, ended_at = ?, score = ?, coins = ?, turn = ?,
      state_json = ?, updated_at = ?
    WHERE id = ?
  `).run(
    record.revision, record.status, record.reason ?? null, record.endedAt,
    record.score, record.coins, record.turn, JSON.stringify(record), now, record.id,
  );
}

export function insertEvents(db, gameId, events, fromSeqExclusive) {
  const stmt = db.prepare(`
    INSERT INTO events (
      game_id, seq, turn, type, elapsed_ms, decision_ms, card_id, row, col,
      removed, reward, hand_count, deck_count, reason, score
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const event of events) {
    if (event.seq <= fromSeqExclusive) continue;

    const [row, col] = Array.isArray(event.position) ? event.position : [null, null];

    stmt.run(
      gameId, event.seq, event.turn, event.type, event.elapsedMs,
      event.decisionMs ?? null, event.cardId ?? null, row, col,
      event.removed ?? null, event.reward ?? null,
      event.handBefore ?? null, event.deckBefore ?? null,
      event.reason ?? null, event.score ?? null,
    );
  }
}
