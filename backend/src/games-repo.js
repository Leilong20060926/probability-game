// 遊戲持久化：state_json 是單一事實來源（含 revision、deck、金礦位置等隱藏資訊）。
// DB 欄位是用來查詢/篩選/匯出的鏡像，每次寫入都同步更新，不單獨信任。
function toRecord(row) {
  if (!row) return null;
  const record = JSON.parse(row.state_json);
  record.ruleset ??= 'grid';
  return record;
}

function isRoute(record) {
  return record.ruleset === 'route-v1';
}

function mapSequence(record) {
  if (!isRoute(record)) return null;
  const ids = record.completedMaps.map(m => m.mapId);
  if (record.status === 'playing' && record.mapId != null) ids.push(record.mapId);
  return ids.join(',');
}

export function insertGame(db, record, deviceType, now) {
  record.mode = 'server';
  record.revision = 0;
  const route = isRoute(record);

  db.prepare(`
    INSERT INTO games (
      id, player_id, attempt, ruleset, version, config_id, revision, source, mode, status, reason,
      started_at, ended_at, score, coins, turn, gold_row, gold_map_index, map_index, map_sequence,
      device_type, config_json, state_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    record.id, record.playerId, record.attempt, record.ruleset ?? 'grid', record.version,
    route ? record.configId : null, record.revision, record.source, record.mode, record.status,
    record.reason ?? null, record.startedAt, record.endedAt, record.score, record.coins, record.turn,
    route ? null : record.goldRow,
    route ? record.goldMapIndex : null,
    route ? record.mapIndex : null,
    mapSequence(record),
    deviceType ?? null,
    route ? JSON.stringify(record.config) : null,
    JSON.stringify(record), now, now,
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
  const route = isRoute(record);
  db.prepare(`
    UPDATE games SET
      revision = ?, status = ?, reason = ?, ended_at = ?, score = ?, coins = ?, turn = ?,
      gold_map_index = ?, map_index = ?, map_sequence = ?, state_json = ?, updated_at = ?
    WHERE id = ?
  `).run(
    record.revision, record.status, record.reason ?? null, record.endedAt,
    record.score, record.coins, record.turn,
    route ? record.goldMapIndex : null, route ? record.mapIndex : null, mapSequence(record),
    JSON.stringify(record), now, record.id,
  );
}

const counts = (obj, keys) => keys.map(k => (obj ? obj[k] ?? null : null));

export function insertEvents(db, gameId, events, fromSeqExclusive) {
  const stmt = db.prepare(`
    INSERT INTO events (
      game_id, seq, turn, type, elapsed_ms, decision_ms, card_id, row, col,
      removed, reward, hand_count, deck_count, reason, score,
      map_index, map_id, pos, branch, a, action, segment,
      pay_h, pay_v, pay_b, pay_x, hand_h, hand_v, hand_b, hand_x,
      deck_h, deck_v, deck_b, deck_x, deck_r, result
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const event of events) {
    if (event.seq <= fromSeqExclusive) continue;

    // 舊格子版：place/discard 的位置在 event.position=[row,col]；reveal/unreveal 的
    // 目標列直接在 event.row。兩者都要存（Codex review 發現 reveal 的 row 曾是空的）。
    const [posRow, posCol] = Array.isArray(event.position) ? event.position : [null, null];
    const row = event.row ?? posRow;
    const col = posCol;

    // 路段版：handBefore/deckBefore 是 {H,V,B,X(,R)} 物件；舊版是張數。
    const handObj = event.handBefore && typeof event.handBefore === 'object' ? event.handBefore : null;
    const deckObj = event.deckBefore && typeof event.deckBefore === 'object' ? event.deckBefore : null;
    const handCount = handObj ? Object.values(handObj).reduce((s, n) => s + n, 0) : event.handBefore ?? null;
    const deckCount = deckObj ? Object.values(deckObj).reduce((s, n) => s + n, 0) : event.deckBefore ?? null;

    stmt.run(
      gameId, event.seq, event.turn, event.type, event.elapsedMs,
      event.decisionMs ?? null, event.cardId ?? event.card ?? event.discard ?? null, row, col,
      event.removed ?? null, event.reward ?? null,
      handCount, deckCount,
      event.reason ?? null, event.score ?? null,
      event.mapIndex ?? null, event.mapId ?? null, event.pos ?? null,
      event.choice ?? event.branch ?? null, event.a ?? null,
      event.action ?? (['exchange', 'choose_branch', 'abandon'].includes(event.type) && event.mapIndex != null ? event.type : null),
      event.segment ?? null,
      ...counts(event.pay, ['H', 'V', 'B', 'X']),
      ...counts(handObj, ['H', 'V', 'B', 'X']),
      ...counts(deckObj, ['H', 'V', 'B', 'X', 'R']),
      event.result ?? null,
    );
  }
}
