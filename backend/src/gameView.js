import { CONFIG, deckCounts } from './engine-adapter.js';
import { clock } from './clock.js';

// 安全序列化：絕不包含 deck、goldRow；未揭曉終點只給 {row, revealed:false}，
// 即使遊戲已結束也一樣——保留不確定性，見 docs/API.md 的「安全狀態」定案。
export function toSafeGameView(record) {
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

const FIELDS_BY_TYPE = {
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

// 只取白名單欄位，過濾 handBefore/deckBefore/elapsedMs 等內部記錄欄位。
export function toSafeEffect(event) {
  const fields = FIELDS_BY_TYPE[event.type] || [];
  const effect = { type: event.type };

  for (const field of fields) {
    effect[field] = event[field];
  }

  return effect;
}

export function effectsSince(events, countBefore) {
  return events.slice(countBefore).map(toSafeEffect);
}
