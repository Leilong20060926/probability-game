// 篩選參數名 → 資料表欄位
const FILTER_COLUMNS = {
  ruleset: 'ruleset',
  version: 'version',
  configId: 'config_id',
  source: 'source',
  mode: 'mode',
  status: 'status',
  reason: 'reason',
};

export const FILTER_KEYS = Object.keys(FILTER_COLUMNS);

function buildWhere(filters, prefix = '') {
  const clauses = [];
  const params = [];

  for (const [key, col] of Object.entries(FILTER_COLUMNS)) {
    if (filters[key]) {
      clauses.push(`${prefix}${col} = ?`);
      params.push(filters[key]);
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
    SELECT id, player_id, attempt, ruleset, version, config_id, source, mode, status, reason,
           started_at, ended_at, score, coins, turn, map_index, map_sequence, device_type
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
      ruleset: row.ruleset,
      version: row.version,
      configId: row.config_id,
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
      mapIndex: row.map_index,
      mapSequence: row.map_sequence,
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

  // 路段版：地圖是「一局內的進度」，與局數分開計。只算已結束的地圖（map_end）。
  const { sql: gWhere, params: gParams } = buildWhere(filters, 'g.');
  const maps = db.prepare(`
    SELECT
      COUNT(*) AS played,
      SUM(CASE WHEN e.result IN ('coin', 'gold') THEN 1 ELSE 0 END) AS passed
    FROM events e JOIN games g ON g.id = e.game_id
    ${gWhere} ${gWhere ? 'AND' : 'WHERE'} e.type = 'map_end'
  `).get(...gParams);

  const byMapId = db.prepare(`
    SELECT e.map_id AS mapId, COUNT(*) AS played,
           SUM(CASE WHEN e.result IN ('coin', 'gold') THEN 1 ELSE 0 END) AS passed
    FROM events e JOIN games g ON g.id = e.game_id
    ${gWhere} ${gWhere ? 'AND' : 'WHERE'} e.type = 'map_end'
    GROUP BY e.map_id ORDER BY e.map_id
  `).all(...gParams);

  return {
    games: totals.games ?? 0,
    players: totals.players ?? 0,
    finished: totals.finished ?? 0,
    goldFinishRate: totals.games ? totals.goldFinishes / totals.games : null,
    avgScore: totals.avgScore ?? null,
    avgDurationMs: totals.avgDurationMs ?? null,
    byReason: Object.fromEntries(byReason.map(r => [r.reason, r.n])),
    byScore: Object.fromEntries(byScore.map(r => [r.score, r.n])),
    maps: {
      played: maps.played ?? 0,
      passed: maps.passed ?? 0,
      passRate: maps.played ? maps.passed / maps.played : null,
      byMapId: Object.fromEntries(byMapId.map(r => [r.mapId, {
        played: r.played,
        passed: r.passed,
        passRate: r.played ? r.passed / r.played : null,
      }])),
    },
  };
}

// 進行中的局不輸出金礦位置：後台已公開讀取，否則玩家能在遊戲中查 CSV 看到答案。
export function exportGameRows(db, filters) {
  const { sql: where, params } = buildWhere(filters);

  return db.prepare(`
    SELECT id AS gameId, player_id AS playerId, attempt, ruleset, version, config_id AS configId,
           source, mode, status, reason, started_at AS startedAt, ended_at AS endedAt,
           (ended_at - started_at) AS durationMs, turn AS turns, score, coins,
           CASE WHEN status = 'playing' THEN NULL ELSE gold_row END AS goldRow,
           CASE WHEN status = 'playing' THEN NULL ELSE gold_map_index END AS goldMapIndex,
           map_index AS mapIndex, map_sequence AS mapSequence, device_type AS deviceType
    FROM games ${where}
    ORDER BY created_at
  `).all(...params);
}

export const GAME_CSV_COLUMNS = [
  'gameId', 'playerId', 'attempt', 'ruleset', 'version', 'configId', 'source', 'mode', 'status',
  'reason', 'startedAt', 'endedAt', 'durationMs', 'turns', 'score', 'coins',
  'goldRow', 'goldMapIndex', 'mapIndex', 'mapSequence', 'deviceType',
];

export function exportEventRows(db, filters) {
  const { sql: where, params } = buildWhere(filters, 'g.');

  return db.prepare(`
    SELECT e.game_id AS gameId, g.ruleset, g.version, g.config_id AS configId,
           e.seq, e.turn, e.type, e.elapsed_ms AS elapsedMs,
           e.decision_ms AS decisionMs, e.card_id AS cardId, e.row, e.col,
           e.removed, e.reward, e.hand_count AS handCount, e.deck_count AS deckCount,
           e.reason, e.score,
           e.map_index AS mapIndex, e.map_id AS mapId, e.pos, e.branch, e.a, e.action, e.segment,
           e.pay_h AS payH, e.pay_v AS payV, e.pay_b AS payB, e.pay_x AS payX,
           e.hand_h AS handH, e.hand_v AS handV, e.hand_b AS handB, e.hand_x AS handX,
           e.deck_h AS deckH, e.deck_v AS deckV, e.deck_b AS deckB, e.deck_x AS deckX, e.deck_r AS deckR,
           e.result
    FROM events e
    JOIN games g ON g.id = e.game_id
    ${where}
    ORDER BY e.game_id, e.seq
  `).all(...params);
}

export const EVENT_CSV_COLUMNS = [
  'gameId', 'ruleset', 'version', 'configId', 'seq', 'turn', 'type', 'elapsedMs', 'decisionMs',
  'cardId', 'row', 'col', 'removed', 'reward', 'handCount', 'deckCount', 'reason', 'score',
  'mapIndex', 'mapId', 'pos', 'branch', 'a', 'action', 'segment',
  'payH', 'payV', 'payB', 'payX', 'handH', 'handV', 'handB', 'handX',
  'deckH', 'deckV', 'deckB', 'deckX', 'deckR', 'result',
];
