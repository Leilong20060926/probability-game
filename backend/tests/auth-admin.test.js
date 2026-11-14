import { test } from 'node:test';
import assert from 'node:assert/strict';

import { startTestServer, makeClient } from './helpers.js';
import { hashPassword } from '../src/password.js';

const ADMIN_USERNAME = process.env.ADMIN_USERNAME;
const ADMIN_PASSWORD_HASH = process.env.ADMIN_PASSWORD_HASH;

function setAdminEnv(username, plainPassword) {
  process.env.ADMIN_USERNAME = username;
  process.env.ADMIN_PASSWORD_HASH = hashPassword(plainPassword);
}

function restoreAdminEnv() {
  process.env.ADMIN_USERNAME = ADMIN_USERNAME;
  process.env.ADMIN_PASSWORD_HASH = ADMIN_PASSWORD_HASH;
}

test('unauthenticated requests to admin games/stats/csv are rejected', async () => {
  const { close, baseUrl } = await startTestServer();
  const client = makeClient(baseUrl);

  try {
    for (const path of ['/api/admin/games', '/api/admin/stats', '/api/admin/export.csv', '/api/admin/events.csv']) {
      const res = await client.get(path);
      assert.equal(res.status, 401, path);
    }
  } finally {
    await close();
  }
});

test('wrong password is rejected and rate limited after repeated attempts', async () => {
  const { close, baseUrl } = await startTestServer();
  const client = makeClient(baseUrl);
  setAdminEnv('rl-user', 'correct-password');

  try {
    for (let i = 0; i < 5; i++) {
      const res = await client.post('/api/admin/login', { username: 'rl-user', password: 'wrong' });
      assert.equal(res.status, 401);
    }

    const limited = await client.post('/api/admin/login', { username: 'rl-user', password: 'wrong' });
    assert.equal(limited.status, 429);
    assert.equal(limited.body.error.code, 'RATE_LIMITED');

    const evenCorrect = await client.post('/api/admin/login', { username: 'rl-user', password: 'correct-password' });
    assert.equal(evenCorrect.status, 429, '鎖定期間即使密碼正確也要擋下');
  } finally {
    await close();
    restoreAdminEnv();
  }
});

test('correct login grants access; logout requires matching CSRF token and revokes the session', async () => {
  const { close, baseUrl } = await startTestServer();
  const client = makeClient(baseUrl);
  setAdminEnv('ok-user', 'correct-password');

  try {
    const login = await client.post('/api/admin/login', { username: 'ok-user', password: 'correct-password' });
    assert.equal(login.status, 200);
    const { csrfToken } = login.body;
    assert.ok(csrfToken);

    const stats = await client.get('/api/admin/stats');
    assert.equal(stats.status, 200);
    assert.equal(stats.body.games, 0);

    const withoutCsrf = await client.post('/api/admin/logout');
    assert.equal(withoutCsrf.status, 403);

    const withWrongCsrf = await client.post('/api/admin/logout', {}, { 'X-CSRF-Token': 'wrong' });
    assert.equal(withWrongCsrf.status, 403);

    const loggedOut = await client.post('/api/admin/logout', {}, { 'X-CSRF-Token': csrfToken });
    assert.equal(loggedOut.status, 200);

    const after = await client.get('/api/admin/stats');
    assert.equal(after.status, 401);
  } finally {
    await close();
    restoreAdminEnv();
  }
});
