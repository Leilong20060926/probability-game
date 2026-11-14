import { test, after } from 'node:test';
import assert from 'node:assert/strict';

import { startTestServer, makeClient } from './helpers.js';
import { clock } from '../src/clock.js';

const realNow = clock.now;
after(() => { clock.now = realNow; });

function setClock(t) {
  clock.now = () => t;
}

async function createGameAt(client, t0, key) {
  setClock(t0);
  await client.post('/api/players');
  const res = await client.post('/api/games', {}, { 'Idempotency-Key': key });
  return res.body;
}

test('server finalizes timeout on read, before the deadline nothing changes', async () => {
  const { close, baseUrl } = await startTestServer();
  const client = makeClient(baseUrl);

  try {
    const t0 = 1_000_000;
    const game = await createGameAt(client, t0, 'k1');

    setClock(t0 + 299_999);
    const before = await client.get('/api/games/current');
    assert.equal(before.body.status, 'playing');
    assert.equal(before.body.revision, 0);

    setClock(t0 + 300_000);
    const at = await client.get('/api/games/current');
    assert.equal(at.body.status, 'finished');
    assert.equal(at.body.reason, 'timeout');
    assert.equal(at.body.endedAt, t0 + 300_000);
    assert.equal(at.body.score, 0);
    assert.equal(at.body.revision, 1);

    setClock(t0 + 400_000);
    const after = await client.get('/api/games/current');
    assert.equal(after.body.revision, 1, '逾時只能結算一次');
    assert.equal(after.body.endedAt, t0 + 300_000);
  } finally {
    await close();
  }
});

test('an action sent after the deadline surfaces timeout via REVISION_CONFLICT, never overwritten by abandon', async () => {
  const { close, baseUrl } = await startTestServer();
  const client = makeClient(baseUrl);

  try {
    const t0 = 2_000_000;
    const game = await createGameAt(client, t0, 'k2');

    setClock(t0 + 300_001);

    const stale = await client.post(`/api/games/${game.id}/actions`, {
      actionId: 'a1', expectedRevision: 0, type: 'abandon',
    });

    assert.equal(stale.status, 409);
    assert.equal(stale.body.error.code, 'REVISION_CONFLICT');
    assert.equal(stale.body.game.reason, 'timeout');
    assert.equal(stale.body.game.revision, 1);

    const retried = await client.post(`/api/games/${game.id}/actions`, {
      actionId: 'a2', expectedRevision: 1, type: 'abandon',
    });

    assert.equal(retried.status, 200);
    assert.equal(retried.body.game.reason, 'timeout', 'abandon 不可覆蓋已逾時的結果');
    assert.deepEqual(retried.body.effects, []);
  } finally {
    await close();
  }
});

test('abandon before the deadline finalizes as abandoned with score 0', async () => {
  const { close, baseUrl } = await startTestServer();
  const client = makeClient(baseUrl);

  try {
    const t0 = 3_000_000;
    const game = await createGameAt(client, t0, 'k3');

    setClock(t0 + 1_000);
    const res = await client.post(`/api/games/${game.id}/actions`, {
      actionId: 'a1', expectedRevision: 0, type: 'abandon',
    });

    assert.equal(res.status, 200);
    assert.equal(res.body.game.reason, 'abandoned');
    assert.equal(res.body.game.score, 0);
    assert.equal(res.body.game.endedAt, t0 + 1_000);
  } finally {
    await close();
  }
});

test('lifecycle restored after the deadline finalizes timeout and reports it as an effect', async () => {
  const { close, baseUrl } = await startTestServer();
  const client = makeClient(baseUrl);

  try {
    const t0 = 4_000_000;
    const game = await createGameAt(client, t0, 'k4');

    setClock(t0 + 10_000);
    const hidden = await client.post(`/api/games/${game.id}/lifecycle`, { type: 'hidden' });
    assert.equal(hidden.status, 200);
    assert.equal(hidden.body.game.status, 'playing');

    setClock(t0 + 300_500);
    const restored = await client.post(`/api/games/${game.id}/lifecycle`, { type: 'restored' });

    assert.equal(restored.status, 200);
    assert.equal(restored.body.game.status, 'finished');
    assert.equal(restored.body.game.reason, 'timeout');
    assert.deepEqual(restored.body.effects, [
      { type: 'end', reason: 'timeout', score: 0 },
    ]);
  } finally {
    await close();
  }
});
