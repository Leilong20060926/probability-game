import { CONFIG, deckCounts, routePublicView } from './engine-adapter.js';
import { clock } from './clock.js';

const isRoute = record => record.ruleset === 'route-v1';

// 安全序列化：絕不包含牌庫順序、金礦位置（goldRow / goldMapIndex）、script。
// 舊格子版未揭曉終點只給 {row, revealed:false}，即使遊戲已結束也一樣。
export function toSafeGameView(record) {
  if (isRoute(record)) {
    return {
      ...routePublicView(record),
      revision: record.revision,
      mode: 'server',
      serverNow: clock.now(),
    };
  }

  const board = Object.entries(record.board).map(([k, cardId]) => {
    const [row, col] = k.split(',').map(Number);
    return { row, col, cardId };
  });

  const targets = [0, 2, 4].map(row => (
    record.revealed.includes(row)
      ? { row, revealed: true, reward: row === record.goldRow ? 'gold' : 'coin' }
      : { row, revealed: false }
  ));

  return {
    id: record.id,
    playerId: record.playerId,
    attempt: record.attempt,
    ruleset: 'grid',
    version: record.version,
    revision: record.revision,
    mode: 'server',
    source: record.source,
    config: { ...CONFIG },
    status: record.status,
    startedAt: record.startedAt,
    deadlineAt: record.startedAt + CONFIG.seconds * 1000,
    serverNow: clock.now(),
    endedAt: record.endedAt,
    hand: [...record.hand],
    deckRemaining: record.deck.length,
    deckCounts: deckCounts(record.deck),
    board,
    targets,
    coins: record.coins,
    turn: record.turn,
    score: record.score,
    reason: record.reason ?? null,
  };
}

const GRID_FIELDS = {
  place: ['cardId', 'position'],
  discard: ['cardId', 'position'],
  draw: ['cardId'],
  rock: ['removed'],
  reveal: ['row', 'reward'],
  unreveal: ['row'],
  end: ['reason', 'score'],
  hidden: [],
  visible: [],
  restored: [],
};

// 路段版：每個 effect 都帶發生當下的 mapIndex/mapId/pos/a，前端依序呈現即可，
// 不需要（也不能）自己重跑亂數。不含 handBefore/deckBefore/decisionMs 等紀錄欄位。
const ROUTE_COMMON = ['mapIndex', 'mapId', 'pos', 'branch', 'a'];
const ROUTE_FIELDS = {
  map_start: [],
  draw: ['card'],
  rock: ['card'],
  pay: ['action', 'pay', 'segment'],
  exchange: ['discard'],
  advance: [],
  fork_ready: [],
  choose_branch: ['choice'],
  reveal: ['reward'],
  map_end: ['result'],
  abandon: [],
  end: ['reason', 'score'],
  hidden: [],
  visible: [],
  restored: [],
  hint_shown: [],
};

export function toSafeEffect(event) {
  const routeEvent = event.mapIndex != null;
  const fields = routeEvent
    ? [...ROUTE_COMMON, ...(ROUTE_FIELDS[event.type] || [])]
    : GRID_FIELDS[event.type] || [];
  const effect = { type: event.type };

  for (const field of fields) {
    effect[field] = event[field] && typeof event[field] === 'object' ? structuredClone(event[field]) : event[field];
  }

  return effect;
}

export function effectsSince(events, countBefore) {
  return events.slice(countBefore).map(toSafeEffect);
}
