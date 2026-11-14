import {uuid} from './uuid.js';

export const VERSION = '0.2.0';

export const CONFIG = Object.freeze({
  rows: 5,
  cols: 6,
  handSize: 5,
  seconds: 300,
  rocks: 4,
});

export const CARDS = Object.freeze([
  { id: 'cross', name: '十字道路', ports: 'UDLR', count: 2 },
  { id: 'horizontal', name: '橫向直路', ports: 'LR', count: 3 },
  { id: 'tee-up', name: '向上岔路', ports: 'LRU', count: 1 },
  { id: 'tee-down', name: '向下岔路', ports: 'LRD', count: 1 },
  { id: 'vertical', name: '縱向直路', ports: 'UD', count: 3 },
  { id: 'tee-left', name: '向左岔路', ports: 'UDL', count: 2 },
  { id: 'tee-right', name: '向右岔路', ports: 'UDR', count: 2 },
  { id: 'bend-dr', name: '右下彎道', ports: 'DR', count: 1 },
  { id: 'bend-ur', name: '右上彎道', ports: 'UR', count: 1 },
  { id: 'bend-dl', name: '左下彎道', ports: 'DL', count: 1 },
  { id: 'bend-ul', name: '左上彎道', ports: 'UL', count: 1 },
]);

const DIRS = [
  ['U', -1, 0, 'D'],
  ['D', 1, 0, 'U'],
  ['L', 0, -1, 'R'],
  ['R', 0, 1, 'L'],
];

export const key = (r, c) => `${r},${c}`;
export const card = id => CARDS.find(c => c.id === id);

const shuffle = (items, rng) => {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
};

export function newGame(
  playerId,
  attempt,
  rng = Math.random,
  now = Date.now(),
) {
  const roads = shuffle(
    CARDS.flatMap(c => Array(c.count).fill(c.id)),
    rng,
  );

  return {
    id: uuid(),
    playerId,
    attempt,
    version: VERSION,
    config: { ...CONFIG },
    source: 'human',
    mode: 'local',
    startedAt: now,
    endedAt: null,
    status: 'playing',
    hand: roads.slice(0, 5),
    deck: shuffle(
      [...roads.slice(5), ...Array(4).fill('rock')],
      rng,
    ),
    board: {},
    placed: [],
    revealed: [],
    goldRow: [0, 2, 4][Math.floor(rng() * 3)],
    coins: 0,
    score: 0,
    turn: 0,
    events: [],
    lastActionAt: now,
  };
}

// Targets accept entry only from column 5.
// They are endpoints, not through-roads.
function portsAt(game, r, c) {
  if (r === 2 && c === 0) return 'R';
  if (c === 5 && [0, 2, 4].includes(r)) return 'L';
  return card(game.board[key(r, c)])?.ports;
}

export function reachable(game) {
  const seen = new Set(['2,0']);
  const queue = [[2, 0]];

  for (const [r, c] of queue) {
    if (c === 5) continue;

    const ports = portsAt(game, r, c) || '';

    for (const [dir, dr, dc, opposite] of DIRS) {
      const nr = r + dr;
      const nc = c + dc;
      const k = key(nr, nc);

      if (
        ports.includes(dir) &&
        portsAt(game, nr, nc)?.includes(opposite) &&
        !seen.has(k)
      ) {
        seen.add(k);
        queue.push([nr, nc]);
      }
    }
  }

  return seen;
}

export function canPlace(game, id, r, c) {
  if (
    game.status !== 'playing' ||
    !card(id) ||
    r < 0 ||
    r >= 5 ||
    c < 0 ||
    c >= 6
  ) {
    return false;
  }

  if (portsAt(game, r, c)) return false;

  const ports = card(id).ports;
  const connected = reachable(game);
  let joins = false;

  for (const [dir, dr, dc, opposite] of DIRS) {
    const nr = r + dr;
    const nc = c + dc;
    const neighbor = portsAt(game, nr, nc);

    if (neighbor === undefined) continue;

    if (ports.includes(dir) !== neighbor.includes(opposite)) {
      return false;
    }

    if (
      ports.includes(dir) &&
      connected.has(key(nr, nc)) &&
      nc !== 5
    ) {
      joins = true;
    }
  }

  return joins;
}

function record(game, type, data, now) {
  game.events.push({
    seq: game.events.length + 1,
    turn: game.turn,
    type,
    elapsedMs: Math.max(0, now - game.startedAt),
    ...data,
  });
}

function finish(game, reason, now) {
  game.status = 'finished';
  game.reason = reason;
  game.endedAt = now;
  game.score = reason === 'gold' ? 60 + 20 * game.coins : 0;

  record(game, 'end', {
    reason,
    score: game.score,
  }, now);
}

export function checkTimeout(game, now = Date.now()) {
  if (
    game.status === 'playing' &&
    now - game.startedAt >= CONFIG.seconds * 1000
  ) {
    finish(
      game,
      'timeout',
      game.startedAt + CONFIG.seconds * 1000,
    );
    return true;
  }

  return false;
}

export function abandon(game, now = Date.now()) {
  if (checkTimeout(game, now)) return;

  if (game.status === 'playing') {
    finish(game, 'abandoned', now);
  }
}

export function recordLifecycle(
  game,
  type,
  now = Date.now(),
) {
  if (
    game.status !== 'playing' ||
    !['hidden', 'visible', 'restored'].includes(type)
  ) {
    return;
  }

  record(game, type, {}, now);
}

export function act(
  game,
  index,
  position = null,
  now = Date.now(),
) {
  if (checkTimeout(game, now) || game.status !== 'playing') {
    return false;
  }

  const id = game.hand[index];

  if (!id || (position && !canPlace(game, id, ...position))) {
    return false;
  }

  game.turn++;
  game.hand.splice(index, 1);

  record(game, position ? 'place' : 'discard', {
    cardId: id,
    position,
    decisionMs: Math.max(0, now - game.lastActionAt),
    handBefore: game.hand.length + 1,
    deckBefore: game.deck.length,
  }, now);

  game.lastActionAt = now;

  const revealedThisTurn = [];

  if (position) {
    const k = key(...position);
    game.board[k] = id;
    game.placed.push(k);

    const connected = reachable(game);

    for (const r of [0, 2, 4]) {
      if (
        connected.has(key(r, 5)) &&
        !game.revealed.includes(r)
      ) {
        game.revealed.push(r);

        record(game, 'reveal', {
          row: r,
          reward: r === game.goldRow ? 'gold' : 'coin',
        }, now);

        if (r === game.goldRow) {
          finish(game, 'gold', now);
          return true;
        }

        game.coins++;
        revealedThisTurn.push(r);
      }
    }
  }

  while (game.deck.length) {
    const drawn = game.deck.shift();

    if (drawn !== 'rock') {
      game.hand.push(drawn);
      record(game, 'draw', { cardId: drawn }, now);
      break;
    }

    const removed = game.placed.pop() || null;

    if (removed) {
      delete game.board[removed];
    }

    record(game, 'rock', { removed }, now);
  }

  // 同一回合內，若落石拆掉了剛接通的道路，撤銷這次翻牌（視為未翻開）。
  // 金礦接通會立即 return，不會走到這裡，故只影響金幣；不同回合才斷線的
  // 翻牌不受影響，仍保留（見 docs/RULES.md 的確認規則）。
  if (revealedThisTurn.length) {
    const stillConnected = reachable(game);

    for (const r of revealedThisTurn) {
      if (!stillConnected.has(key(r, 5))) {
        game.revealed.splice(game.revealed.indexOf(r), 1);
        game.coins--;

        record(game, 'unreveal', { row: r }, now);
      }
    }
  }

  if (!game.hand.length && !game.deck.length) {
    finish(game, 'exhausted', now);
  }

  return true;
}
