import { test } from 'node:test';
import assert from 'node:assert/strict';

import { startTestServer, makeClient } from './helpers.js';
import { canPlace } from '../src/engine-adapter.js';

// 用回傳的 board/hand 當「機器人」找合法落點，不依賴已知 goldRow，
// 確保遊戲可以在真實 HTTP 流程下跑完整局並正確結算。
function findLegalMove(view) {
  const board = {};
  for (const cell of view.board) {
    board[`${cell.row},${cell.col}`] = cell.cardId;
  }
  const fakeGame = { status: 'playing', board };

  for (let i = 0; i < view.hand.length; i++) {
    for (let row = 0; row < view.config.rows; row++) {
      for (let col = 0; col < view.config.cols; col++) {
        if (canPlace(fakeGame, view.hand[i], row, col)) {
          return { handIndex: i, row, col };
        }
      }
    }
  }

  return null;
}

test('full HTTP play-through finishes with a consistent score', async () => {
  const { close, baseUrl } = await startTestServer();
  const client = makeClient(baseUrl);

  try {
    const playerRes = await client.post('/api/players');
    assert.equal(playerRes.status, 201);

    const createRes = await client.post('/api/games', {}, { 'Idempotency-Key': 'create-1' });
    assert.equal(createRes.status, 201);

    let view = createRes.body;
    const gameId = view.id;
    let actionCounter = 0;
    let lastRevision = view.revision;

    for (let turns = 0; turns < 200 && view.status === 'playing'; turns++) {
      const move = findLegalMove(view);

      const action = move
        ? { actionId: `a${actionCounter++}`, expectedRevision: view.revision, type: 'place', handIndex: move.handIndex, row: move.row, col: move.col }
        : { actionId: `a${actionCounter++}`, expectedRevision: view.revision, type: 'discard', handIndex: 0 };

      const res = await client.post(`/api/games/${gameId}/actions`, action);
      assert.equal(res.status, 200, JSON.stringify(res.body));

      view = res.body.game;
      assert.ok(view.revision > lastRevision, 'revision 必須單調遞增');
      lastRevision = view.revision;

      assert.ok(view.deckRemaining >= 0);
      assert.ok(!view.hand.includes(undefined));
    }

    assert.equal(view.status, 'finished');
    assert.ok(['gold', 'exhausted'].includes(view.reason), `unexpected reason ${view.reason}`);

    if (view.reason === 'gold') {
      assert.equal(view.score, 60 + 20 * view.coins);
      assert.ok(view.targets.some(t => t.revealed && t.reward === 'gold'));
    } else {
      assert.equal(view.score, 0);
    }

    for (const target of view.targets) {
      assert.ok(!('reward' in target) || target.revealed);
    }

    // 遊戲結束後，重新 GET current 應回同一局最終結果，不重複結算。
    const current = await client.get('/api/games/current');
    assert.equal(current.status, 200);
    assert.equal(current.body.id, gameId);
    assert.equal(current.body.revision, view.revision);
    assert.equal(current.body.status, 'finished');
  } finally {
    await close();
  }
});
