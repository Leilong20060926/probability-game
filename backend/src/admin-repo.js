const FILTER_COLUMNS = ['version', 'source', 'mode', 'status', 'reason'];

function buildWhere(filters, prefix = '') {
  const clauses = [];
  const params = [];

  for (const col of FILTER_COLUMNS) {
    if (filters[col]) {
      clauses.push(`${prefix}${col} = ?`);
      params.push(filters[col]);
    }
  }

  return {
    sql: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '',
    params,
  };
}

export function listGames(db, filters, page = 1, pageSize = 50) {
  const { sql: where, params } = buildWhere(filters);
  const limit = Math.min(Math.max(pageSize, 1), 200);
  const offset = (Math.max(page, 1) - 1) * limit;

  const total = db.prepare(`SELECT COUNT(*) AS n FROM games ${where}`).get(...params).n;

  const rows = db.prepare(`
    SELECT id, player_id, attempt, version, source, mode, status, reason,
           started_at, ended_at, score, coins, turn, device_type
    FROM games ${where}
    ORDER BY created_at DESC
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset);

  return {
    total,
    page: Math.max(page, 1),
    pageSize: limit,
    games: rows.map(row => ({
      id: row.id,
      playerId: row.player_id,
      attempt: row.attempt,
      version: row.version,
      source: row.source,
      mode: row.mode,
      status: row.status,
      reason: row.reason,
      startedAt: row.started_at,
      endedAt: row.ended_at,
      durationMs: row.ended_at != null ? row.ended_at - row.started_at : null,
      score: row.score,
      coins: row.coins,
      turns: row.turn,
      deviceType: row.device_type,
    })),
  };
}

export function gameStats(db, filters) {
  const { sql: where, params } = buildWhere(filters);

  const totals = db.prepare(`
    SELECT
      COUNT(*) AS games,
      COUNT(DISTINCT player_id) AS players,
      SUM(CASE WHEN status = 'finished' THEN 1 ELSE 0 END) AS finished,
      SUM(CASE WHEN reason = 'gold' THEN 1 ELSE 0 END) AS goldFinishes,
      AVG(CASE WHEN status = 'finished' THEN score END) AS avgScore,
      AVG(CASE WHEN ended_at IS NOT NULL THEN ended_at - started_at END) AS avgDurationMs
    FROM games ${where}
  `).get(...params);

  const byReason = db.prepare(`
    SELECT reason, COUNT(*) AS n FROM games ${where}
    ${where ? 'AND' : 'WHERE'} reason IS NOT NULL
    GROUP BY reason
  `).all(...params);

  const byScore = db.prepare(`
    SELECT score, COUNT(*) AS n FROM games ${where}
    ${where ? 'AND' : 'WHERE'} status = 'finished'
    GROUP BY score
    ORDER BY score
  `).all(...params);

  return {
    games: totals.games ?? 0,
    players: totals.players ?? 0,
    finished: totals.finished ?? 0,
    goldFinishRate: totals.games ? totals.goldFinishes / totals.games : null,
    avgScore: totals.avgScore ?? null,
    avgDurationMs: totals.avgDurationMs ?? null,
    byReason: Object.fromEntries(byReason.map(r => [r.reason, r.n])),
    byScore: Object.fromEntries(byScore.map(r => [r.score, r.n])),
  };
}

export function exportGameRows(db, filters) {
  const { sql: where, params } = buildWhere(filters);

  return db.prepare(`
    SELECT id AS gameId, player_id AS playerId, attempt, version, source, mode,
           status, reason, started_at AS startedAt, ended_at AS endedAt,
           (ended_at - started_at) AS durationMs, turn AS turns, score, coins,
           gold_row AS goldRow, device_type AS deviceType
    FROM games ${where}
    ORDER BY created_at
  `).all(...params);
}

export function exportEventRows(db, filters) {
  const { sql: where, params } = buildWhere(filters, 'g.');

  return db.prepare(`
    SELECT e.game_id AS gameId, e.seq, e.turn, e.type, e.elapsed_ms AS elapsedMs,
           e.decision_ms AS decisionMs, e.card_id AS cardId, e.row, e.col,
           e.removed, e.reward, e.hand_count AS handCount, e.deck_count AS deckCount,
           e.reason, e.score
    FROM events e
    JOIN games g ON g.id = e.game_id
    ${where}
    ORDER BY e.game_id, e.seq
  `).all(...params);
}
