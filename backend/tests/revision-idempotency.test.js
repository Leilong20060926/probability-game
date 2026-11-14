import { test } from 'node:test';
import assert from 'node:assert/strict';

import { startTestServer, makeClient } from './helpers.js';

async function createGame(client, key = 'create-1') {
  await client.post('/api/players');
  const res = await client.post('/api/games', {}, { 'Idempotency-Key': key });
  return res.body;
}

test('creating a game twice with the same Idempotency-Key replays the same game', async () => {
  const { close, baseUrl } = await startTestServer();
  const client = makeClient(baseUrl);

  try {
    const first = await createGame(client, 'same-key');
    const second = await client.post('/api/games', {}, { 'Idempotency-Key': 'same-key' });

    assert.equal(second.status, 201);
    assert.equal(second.body.id, first.id);
  } finally {
    await close();
  }
});

test('creating a game without a key while one is in progress returns 409 GAME_IN_PROGRESS', async () => {
  const { close, baseUrl } = await startTestServer();
  const client = makeClient(baseUrl);

  try {
    await createGame(client, 'key-a');
    const res = await client.post('/api/games', {}, { 'Idempotency-Key': 'key-b' });

    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, 'GAME_IN_PROGRESS');
  } finally {
    await close();
  }
});

test('retrying an actionId replays the original response and does not re-advance the turn', async () => {
  const { close, baseUrl } = await startTestServer();
  const client = makeClient(baseUrl);

  try {
    const game = await createGame(client);
    const action = { actionId: 'a1', expectedRevision: 0, type: 'discard', handIndex: 0 };

    const first = await client.post(`/api/games/${game.id}/actions`, action);
    const replay = await client.post(`/api/games/${game.id}/actions`, action);

    assert.equal(first.status, 200);
    assert.deepEqual(replay.body, first.body);
    assert.equal(replay.body.game.turn, 1);
  } finally {
    await close();
  }
});

test('reusing an actionId with a different body returns 409 IDEMPOTENCY_KEY_REUSE', async () => {
  const { close, baseUrl } = await startTestServer();
  const client = makeClient(baseUrl);

  try {
    const game = await createGame(client);

    await client.post(`/api/games/${game.id}/actions`, {
      actionId: 'dup', expectedRevision: 0, type: 'discard', handIndex: 0,
    });

    const conflict = await client.post(`/api/games/${game.id}/actions`, {
      actionId: 'dup', expectedRevision: 0, type: 'discard', handIndex: 1,
    });

    assert.equal(conflict.status, 409);
    assert.equal(conflict.body.error.code, 'IDEMPOTENCY_KEY_REUSE');
  } finally {
    await close();
  }
});

test('a stale expectedRevision returns 409 REVISION_CONFLICT with the latest safe state', async () => {
  const { close, baseUrl } = await startTestServer();
  const client = makeClient(baseUrl);

  try {
    const game = await createGame(client);

    await client.post(`/api/games/${game.id}/actions`, {
      actionId: 'first', expectedRevision: 0, type: 'discard', handIndex: 0,
    });

    const stale = await client.post(`/api/games/${game.id}/actions`, {
      actionId: 'second', expectedRevision: 0, type: 'discard', handIndex: 0,
    });

    assert.equal(stale.status, 409);
    assert.equal(stale.body.error.code, 'REVISION_CONFLICT');
    assert.equal(stale.body.game.revision, 1);
    assert.equal(stale.body.game.turn, 1);
  } finally {
    await close();
  }
});

test('an illegal placement is rejected without consuming a card or turn', async () => {
  const { close, baseUrl } = await startTestServer();
  const client = makeClient(baseUrl);

  try {
    const game = await createGame(client);

    const res = await client.post(`/api/games/${game.id}/actions`, {
      actionId: 'bad', expectedRevision: 0, type: 'place', handIndex: 0, row: 4, col: 5,
    });

    assert.equal(res.status, 422);
    assert.equal(res.body.error.code, 'INVALID_ACTION');

    const current = await client.get('/api/games/current');
    assert.equal(current.body.turn, 0);
    assert.equal(current.body.revision, 0);
    assert.deepEqual(current.body.hand, game.hand);
  } finally {
    await close();
  }
});

test('switching player cannot read or act on the previous player\'s game', async () => {
  const { close, baseUrl } = await startTestServer();
  const client = makeClient(baseUrl);

  try {
    const game = await createGame(client);

    const switched = await client.post('/api/players/switch');
    assert.equal(switched.status, 201);
    assert.notEqual(switched.body.playerId, undefined);

    const current = await client.get('/api/games/current');
    assert.equal(current.status, 204);

    const attempt = await client.post(`/api/games/${game.id}/actions`, {
      actionId: 'x', expectedRevision: 0, type: 'discard', handIndex: 0,
    });
    assert.equal(attempt.status, 404);
  } finally {
    await close();
  }
});

test('GET /api/games/current without a player session is unauthorized', async () => {
  const { close, baseUrl } = await startTestServer();
  const client = makeClient(baseUrl);

  try {
    const res = await client.get('/api/games/current');
    assert.equal(res.status, 401);
    assert.equal(res.body.error.code, 'UNAUTHORIZED');
  } finally {
    await close();
  }
});
