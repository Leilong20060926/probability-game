import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { randomUUID } from 'node:crypto';

import { startTestServer, makeClient } from './helpers.js';
import { issuePlayerSession } from '../src/session.js';

// 迴歸測試：Codex review 發現的 P1——body 還在等待時，另一個請求先確認了狀態，
// 延遲請求用過期的記憶體物件通過 revision 檢查，把已確認的 turn 蓋回去
// （scripts/review-backend.mjs 的重現腳本）。修法是把 await readJsonBody 移到
// 讀取遊戲列之前，讀取與處理之間不再有 await。
test('a slow-bodied request cannot roll back a turn that was already confirmed', async () => {
  const { close, baseUrl, server } = await startTestServer();
  const client = makeClient(baseUrl);

  try {
    await client.post('/api/players');
    const game = (await client.post('/api/games', {}, { 'Idempotency-Key': randomUUID() })).body;

    const delayedBody = JSON.stringify({
      actionId: randomUUID(), expectedRevision: 0, type: 'discard', handIndex: 99,
    });

    let delayedReq;
    const delayedDone = new Promise((resolve, reject) => {
      delayedReq = http.request(`${baseUrl}/api/games/${game.id}/actions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(delayedBody),
          Cookie: Object.entries(client.cookies).map(([k, v]) => `${k}=${v}`).join('; '),
        },
      }, response => {
        let text = '';
        response.on('data', c => { text += c; });
        response.on('end', () => resolve({ status: response.statusCode, body: JSON.parse(text) }));
      });
      delayedReq.on('error', reject);
      delayedReq.flushHeaders();
    });

    // 等伺服器已經進到等待這個 request body 的狀態，再送出第二個合法請求。
    await new Promise(resolve => {
      const poll = () => server.getConnections((_, n) => (n > 0 ? setTimeout(resolve, 30) : setTimeout(poll, 5)));
      poll();
    });

    const valid = await client.post(`/api/games/${game.id}/actions`, {
      actionId: randomUUID(), expectedRevision: 0, type: 'discard', handIndex: 0,
    });
    assert.equal(valid.status, 200);
    assert.equal(valid.body.game.turn, 1);

    delayedReq.end(delayedBody);
    const delayed = await delayedDone;

    // 延遲請求送達時 revision 早就不是 0 了，應該拿到 409，不是悄悄成功覆寫。
    assert.equal(delayed.status, 409);
    assert.equal(delayed.body.error.code, 'REVISION_CONFLICT');

    const current = await client.get('/api/games/current');
    assert.equal(current.body.turn, 1, '已確認的 turn 不可被延遲請求回退');
    assert.equal(current.body.revision, 1);
  } finally {
    await close();
  }
});

// 迴歸測試：session.js 曾在模組載入時把 COOKIE_SECURE 算成常數，
// server.js 載入 .env 的時間點比 import 晚，設定永遠不會生效。
test('COOKIE_SECURE is read at cookie-issue time, not at module import time', () => {
  const previous = process.env.COOKIE_SECURE;

  try {
    delete process.env.COOKIE_SECURE;

    const db = { prepare: () => ({ run: () => {} }) };
    const headers = new Map();
    const res = { getHeader: name => headers.get(name), setHeader: (name, v) => headers.set(name, v) };

    issuePlayerSession(db, res, 'player-1');
    assert.ok(
      !headers.get('Set-Cookie').some(c => c.includes('Secure')),
      'COOKIE_SECURE 未設定時不應該有 Secure',
    );

    process.env.COOKIE_SECURE = 'true';
    const headers2 = new Map();
    const res2 = { getHeader: name => headers2.get(name), setHeader: (name, v) => headers2.set(name, v) };
    issuePlayerSession(db, res2, 'player-1');

    assert.ok(
      headers2.get('Set-Cookie').every(c => c.includes('Secure')),
      '執行期設定 COOKIE_SECURE=true 之後，立刻發出的 cookie 就要帶 Secure',
    );
  } finally {
    if (previous === undefined) delete process.env.COOKIE_SECURE;
    else process.env.COOKIE_SECURE = previous;
  }
});

test('GAME_IN_PROGRESS now carries the current safe GameView, per docs/API.md v0.2', async () => {
  const { close, baseUrl } = await startTestServer();
  const client = makeClient(baseUrl);

  try {
    await client.post('/api/players');
    const game = (await client.post('/api/games', {}, { 'Idempotency-Key': randomUUID() })).body;
    const res = await client.post('/api/games', {}, { 'Idempotency-Key': randomUUID() });

    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, 'GAME_IN_PROGRESS');
    assert.equal(res.body.game.id, game.id);
    assert.equal(res.body.game.status, 'playing');
  } finally {
    await close();
  }
});

test('lifecycle eventId dedupes repeated delivery and is optional for backward compatibility', async () => {
  const { close, baseUrl } = await startTestServer();
  const client = makeClient(baseUrl);

  try {
    await client.post('/api/players');
    const game = (await client.post('/api/games', {}, { 'Idempotency-Key': randomUUID() })).body;

    const withoutEventId = await client.post(`/api/games/${game.id}/lifecycle`, { type: 'hidden' });
    assert.equal(withoutEventId.status, 200);

    const eventId = randomUUID();
    const first = await client.post(`/api/games/${game.id}/lifecycle`, { type: 'visible', eventId });
    const replay = await client.post(`/api/games/${game.id}/lifecycle`, { type: 'visible', eventId });

    assert.deepEqual(replay.body, first.body);
    assert.equal(replay.body.game.revision, first.body.game.revision, '重送不應該再推進一次 revision');

    const conflicting = await client.post(`/api/games/${game.id}/lifecycle`, { type: 'hidden', eventId });
    assert.equal(conflicting.status, 409);
    assert.equal(conflicting.body.error.code, 'IDEMPOTENCY_KEY_REUSE');
  } finally {
    await close();
  }
});
