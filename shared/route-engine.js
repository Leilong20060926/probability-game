// 三地圖路段版（route-v1）規則引擎。純 ES module，前後端共用；不依賴 DOM、http、sqlite。
// 隱藏資訊（deck 順序、goldMapIndex、script）只存在 state，絕不經 routePublicView 外流。

import {
  RULESET, ROUTE_VERSION, ROAD_TYPES, DECK_TYPES, SEGMENTS, makeConfig, publicConfig,
} from './route-config.js';
import { legalActions, canPave, posToObject } from './route-analysis.js';

export { RULESET, ROUTE_VERSION };

const PLAYER_ACTIONS = ['pave', 'dig', 'exchange', 'choose_branch', 'abandon'];
// hint_shown：玩家實際打開提示的紀錄（以 eventId 去重），不是遊戲動作、不算 turn。
const LIFECYCLE = ['hidden', 'visible', 'restored', 'hint_shown'];

function randomId() {
  const c = globalThis.crypto;
  if (c?.randomUUID) return c.randomUUID();
  const b = c.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map(x => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

function shuffle(items, rng) {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

const handArray = hand => ROAD_TYPES.map(t => hand[t]);
const handTotal = hand => hand.H + hand.V + hand.B + hand.X;

export function deckCountsOf(deck) {
  const counts = { H: 0, V: 0, B: 0, X: 0, R: 0 };
  for (const t of deck) counts[t]++;
  return counts;
}

const deckArray = deck => { const c = deckCountsOf(deck); return DECK_TYPES.map(t => c[t]); };

function need(game) {
  const map = game.config.maps[game.mapId];
  if (game.pos === 'F') return SEGMENTS[map.first];
  if (game.pos[0] === 'A' || game.pos[0] === 'B') return SEGMENTS[map[game.pos[0]][Number(game.pos.slice(1))]];
  return null;
}

function segmentCode(game) {
  const map = game.config.maps[game.mapId];
  if (game.pos === 'F') return map.first;
  if (game.pos[0] === 'A' || game.pos[0] === 'B') return map[game.pos[0]][Number(game.pos.slice(1))];
  return null;
}

function nextPos(game) {
  if (game.pos === 'F') return 'K';
  const line = game.config.maps[game.mapId][game.pos[0]];
  const i = Number(game.pos.slice(1)) + 1;
  return i < line.length ? `${game.pos[0]}${i}` : 'E';
}

function record(game, type, data, now) {
  game.events.push({
    seq: game.events.length + 1,
    turn: game.turn,
    type,
    elapsedMs: Math.max(0, now - game.startedAt),
    mapIndex: game.mapIndex,
    mapId: game.mapId,
    pos: game.pos,
    branch: game.branch,
    a: game.a,
    ...data,
  });
}

function finish(game, reason, now) {
  game.status = 'finished';
  game.reason = reason;
  game.endedAt = now;
  game.score = reason === 'gold' ? game.config.goldScore + game.config.coinScore * game.coins : 0;
  record(game, 'end', { reason, score: game.score }, now);
}

function pickMapId(game, rng) {
  if (game.script?.mapIds?.length) return game.script.mapIds.shift();
  return 1 + Math.floor(rng() * 3);
}

function freshDeck(game, rng) {
  if (game.script?.decks?.length) return [...game.script.decks.shift()];
  const d = game.config.deck;
  return shuffle(DECK_TYPES.flatMap(t => Array(d[t]).fill(t)), rng);
}

// 抽到 n 張道路牌或牌庫空為止；每張落石讓「目前位置」a+1。
function drawRoads(game, n, now) {
  let got = 0;
  while (got < n && game.deck.length) {
    const t = game.deck.shift();
    if (t === 'R') {
      game.a++;
      record(game, 'rock', { card: 'R' }, now);
    } else {
      game.hand[t]++;
      got++;
      record(game, 'draw', { card: t }, now);
    }
  }
}

function startMap(game, rng, now) {
  game.mapIndex++;
  game.mapId = pickMapId(game, rng);
  game.deck = freshDeck(game, rng);
  game.hand = { H: 0, V: 0, B: 0, X: 0 };
  game.pos = 'F';
  game.branch = null;
  game.a = 0;
  game.mapActionCount = 0;
  record(game, 'map_start', {}, now);
  drawRoads(game, game.config.handLimit, now);
  checkStuck(game, now);
}

// 只有「牌庫空，且手牌付不出鋪路也付不出硬挖」才失敗；岔路不是路段，不在此判定。
function checkStuck(game, now) {
  if (game.status !== 'playing' || game.pos === 'K' || game.deck.length) return false;
  const actions = legalActions(game.config, String(game.mapId), game.pos, game.a, handArray(game.hand), deckArray(game.deck));
  if (actions.length) return false;
  game.completedMaps.push({ mapIndex: game.mapIndex, mapId: game.mapId, branch: game.branch, result: 'fail' });
  record(game, 'map_end', { result: 'fail' }, now);
  finish(game, 'exhausted', now);
  return true;
}

export function newRouteGame({
  playerId,
  attempt,
  rng = Math.random,
  now = Date.now(),
  config = makeConfig(),
  id = randomId(),
  script = null,
} = {}) {
  const game = {
    id,
    playerId,
    attempt,
    ruleset: RULESET,
    version: ROUTE_VERSION,
    configId: config.configId,
    config: structuredClone(config),
    source: 'human',
    mode: 'local',
    status: 'playing',
    reason: null,
    score: 0,
    startedAt: now,
    deadlineAt: now + config.timeLimitMs,
    endedAt: null,
    lastActionAt: now,
    script: script ? structuredClone(script) : null,
    goldMapIndex: script?.goldMapIndex ?? 1 + Math.floor(rng() * config.maxMaps),
    mapIndex: 0,
    mapId: null,
    pos: 'F',
    branch: null,
    a: 0,
    hand: { H: 0, V: 0, B: 0, X: 0 },
    deck: [],
    coins: 0,
    turn: 0,
    mapActionCount: 0,
    completedMaps: [],
    events: [],
  };
  startMap(game, rng, now);
  return game;
}

// 嚴格截止：now >= deadlineAt 一律先判 timeout；endedAt 固定為 deadlineAt。
export function routeCheckTimeout(game, now = Date.now()) {
  if (game.status === 'playing' && now >= game.deadlineAt) {
    finish(game, 'timeout', game.deadlineAt);
    return true;
  }
  return false;
}

export function routeAbandon(game, now = Date.now()) {
  if (routeCheckTimeout(game, now)) return;
  if (game.status === 'playing') finish(game, 'abandoned', now);
}

export function routeRecordLifecycle(game, type, now = Date.now()) {
  if (game.status !== 'playing' || !LIFECYCLE.includes(type)) return;
  record(game, type, {}, now);
}

function validPay(pay, hand) {
  if (!pay || typeof pay !== 'object') return null;
  const out = [];
  for (const t of ROAD_TYPES) {
    const n = pay[t] ?? 0;
    if (!Number.isInteger(n) || n < 0 || n > hand[t]) return null;
    out.push(n);
  }
  if (Object.keys(pay).some(k => !ROAD_TYPES.includes(k))) return null;
  return out;
}

const invalid = message => ({ ok: false, code: 'INVALID_ACTION', message });

// 執行一個玩家動作。非法動作完全不改狀態（含事件、turn、lastActionAt）。
export function routeAct(game, action, now = Date.now(), rng = Math.random) {
  if (routeCheckTimeout(game, now)) return { ok: false, code: 'TIMEOUT', message: '已超過 300 秒' };
  if (game.status !== 'playing') return invalid('遊戲已結束');
  if (!action || !PLAYER_ACTIONS.includes(action.type)) return invalid('未知的動作');

  if (action.type === 'abandon') {
    record(game, 'abandon', { decisionMs: Math.max(0, now - game.lastActionAt) }, now);
    game.lastActionAt = now;
    finish(game, 'abandoned', now);
    return { ok: true };
  }

  if (action.type === 'choose_branch') {
    if (game.pos !== 'K') return invalid('目前不在岔路');
    if (!['A', 'B'].includes(action.branch)) return invalid('branch 必須是 A 或 B');
    record(game, 'choose_branch', {
      choice: action.branch,
      decisionMs: Math.max(0, now - game.lastActionAt),
      ...snapshot(game),
    }, now);
    game.lastActionAt = now;
    game.branch = action.branch;
    game.pos = `${action.branch}0`;
    checkStuck(game, now);
    return { ok: true };
  }

  if (game.pos === 'K') return invalid('請先選擇 A 線或 B 線');

  if (action.type === 'exchange') {
    if (!game.deck.length) return invalid('牌庫已空，不能換牌');
    if (!ROAD_TYPES.includes(action.discard) || game.hand[action.discard] < 1) return invalid('沒有這種手牌可以棄');
    game.turn++;
    game.mapActionCount++;
    record(game, 'exchange', {
      discard: action.discard,
      decisionMs: Math.max(0, now - game.lastActionAt),
      ...snapshot(game),
    }, now);
    game.lastActionAt = now;
    game.hand[action.discard]--;
    drawRoads(game, 1, now);
    checkStuck(game, now);
    return { ok: true };
  }

  // pave / dig
  const pay = validPay(action.pay, game.hand);
  if (!pay) return invalid('付牌組成不合法或超出手牌');
  const n = need(game);
  if (action.type === 'pave') {
    if (!canPave(n, game.a, pay)) return invalid('付牌不符合這段路的需求');
  } else {
    if (!game.config.allowDig) return invalid('此設定不允許硬挖');
    if (pay.reduce((s, x) => s + x, 0) !== game.config.digBase + game.a) return invalid(`硬挖必須剛好付 ${game.config.digBase + game.a} 張`);
  }

  game.turn++;
  game.mapActionCount++;
  record(game, 'pay', {
    action: action.type,
    pay: { H: pay[0], V: pay[1], B: pay[2], X: pay[3] },
    segment: segmentCode(game),
    decisionMs: Math.max(0, now - game.lastActionAt),
    ...snapshot(game),
  }, now);
  game.lastActionAt = now;
  ROAD_TYPES.forEach((t, i) => { game.hand[t] -= pay[i]; });

  const next = nextPos(game);
  if (next === 'E') {
    // 末段：不補牌，直接翻終點；金礦最優先。
    game.pos = 'E';
    game.a = 0;
    const reward = game.mapIndex === game.goldMapIndex ? 'gold' : 'coin';
    record(game, 'reveal', { reward }, now);
    game.completedMaps.push({ mapIndex: game.mapIndex, mapId: game.mapId, branch: game.branch, result: reward });
    record(game, 'map_end', { result: reward }, now);
    if (reward === 'gold') {
      finish(game, 'gold', now);
    } else {
      game.coins++;
      startMap(game, rng, now);
    }
    return { ok: true };
  }

  game.pos = next;
  game.a = 0;
  record(game, 'advance', {}, now);
  drawRoads(game, game.config.handLimit - handTotal(game.hand), now);
  if (game.pos === 'K') {
    record(game, 'fork_ready', {}, now);
  } else {
    checkStuck(game, now);
  }
  return { ok: true };
}

function snapshot(game) {
  return { handBefore: { ...game.hand }, deckBefore: deckCountsOf(game.deck) };
}

export function phaseOf(game) {
  if (game.status !== 'playing') return 'finished';
  return game.pos === 'K' ? 'fork' : 'segment';
}

// 前後端共用的公開狀態：不含 deck 順序、goldMapIndex、script 或未來地圖。
export function routePublicView(game) {
  const n = game.status === 'playing' ? need(game) : null;
  const deckCounts = deckCountsOf(game.deck);
  return {
    id: game.id,
    playerId: game.playerId,
    attempt: game.attempt,
    ruleset: game.ruleset,
    version: game.version,
    configId: game.configId,
    publicConfig: publicConfig(game.config),
    mode: game.mode,
    source: game.source,
    status: game.status,
    mapIndex: game.mapIndex,
    mapId: game.mapId,
    phase: phaseOf(game),
    position: posToObject(game.pos),
    branch: game.branch,
    segment: game.status === 'playing' ? segmentCode(game) : null,
    need: n ? { ...n } : null,
    a: game.a,
    paveCost: n ? n.H + n.V + n.B + game.a : null,
    digCost: n && game.config.allowDig ? game.config.digBase + game.a : null,
    hand: { ...game.hand },
    deckCounts,
    deckRemaining: game.deck.length,
    coins: game.coins,
    turn: game.turn,
    mapActionCount: game.mapActionCount,
    completedMaps: game.completedMaps.map(m => ({ ...m })),
    startedAt: game.startedAt,
    deadlineAt: game.deadlineAt,
    endedAt: game.endedAt,
    score: game.score,
    reason: game.reason,
  };
}

// 提示／求解器用的狀態鍵（全為公開資訊）
export function solverState(game) {
  return {
    mapId: String(game.mapId),
    pos: game.pos,
    a: game.a,
    hand: handArray(game.hand),
    deck: deckArray(game.deck),
  };
}
