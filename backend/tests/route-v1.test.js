// route-v1（三地圖路段版）經真實 HTTP 的整合測試。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { startTestServer, makeClient } from './helpers.js';
import { clock } from '../src/clock.js';
import { getGame, insertEvents, saveGame } from '../src/games-repo.js';
import { newRouteGame } from '../../shared/route-engine.js';
import { makeConfig } from '../../shared/route-config.js';

function deck(prefix) {
  const counts = { H: 4, V: 4, B: 2, X: 1, R: 5 };
  for (const c of prefix) counts[c]--;
  return [...prefix, ...'HVBXR'.split('').flatMap(t => Array(counts[t]).fill(t))];
}

// 每張地圖都走 B 線：HH {H2} → 岔路 B → HH {H1,X1} → HV {H1,V1}，4 個動作＋1 次選路
const MAP_DECK = () => deck('HHHVV' + 'XB' + 'HV');
const MAP_STEPS = [
  { type: 'pave', pay: { H: 2 } },
  { type: 'choose_branch', branch: 'B' },
  { type: 'pave', pay: { H: 1, X: 1 } },
  { type: 'pave', pay: { H: 1, V: 1 } },
];

// 把剛建立的局換成固定牌序的同一局（同 id／玩家／開始時間），讓 HTTP 流程可重現。
function scriptGame(db, gameId, script) {
  const old = getGame(db, gameId);
  const game = newRouteGame({
    playerId: old.playerId, attempt: old.attempt, now: old.startedAt, config: makeConfig(), id: old.id, script,
  });
  game.mode = 'server';
  game.revision = old.revision;
  db.prepare('DELETE FROM events WHERE game_id = ?').run(gameId);
  insertEvents(db, gameId, game.events, 0);
  saveGame(db, game, old.startedAt);
  return game;
}

async function setup() {
  const server = await startTestServer();
  const client = makeClient(server.baseUrl);
  await client.post('/api/players');
  const created = await client.post('/api/games', { ruleset: 'route-v1', deviceType: 'pointer' }, { 'Idempotency-Key': randomUUID() });
  assert.equal(created.status, 201);
  return { ...server, client, game: created.body };
}

function actor(client, gameId) {
  let revision = 0;
  return {
    set revision(r) { revision = r; },
    async send(step, extra = {}) {
      const res = await client.post(`/api/games/${gameId}/actions`, {
        actionId: randomUUID(), expectedRevision: revision, ...step, ...extra,
      });
      if (res.body?.game) revision = res.body.game.revision;
      return res;
    },
  };
}

// 依 RFC 4180 讀回匯出的 CSV（含 BOM、引號、CRLF）
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const [header, ...data] = rows;
  return data.map(cells => Object.fromEntries(header.map((h, k) => [h, cells[k]])));
}

const SECRETS =['goldMapIndex', 'script', '"deck":[', 'mapIds', '"decks"'];
const assertNoSecrets = (body, label) => {
  const text = JSON.stringify(body);
  for (const s of SECRETS) assert.ok(!text.includes(s), `${label} leaked ${s}`);
};

test('route-v1: full three-map HTTP game (coin → coin → gold = 100) with safe views and ordered effects', async () => {
  const { close, db, client, game } = await setup();
  try {
    assert.equal(game.ruleset, 'route-v1');
    assert.equal(game.version, '0.4.0');
    assert.equal(game.phase, 'segment');
    assert.equal(game.mapIndex, 1);
    assert.ok([1, 2, 3].includes(game.mapId));
    assert.equal(game.configId, makeConfig().configId);
    assertNoSecrets(game, 'create');

    scriptGame(db, game.id, { mapIds: [1, 1, 1], goldMapIndex: 3, decks: [MAP_DECK(), MAP_DECK(), MAP_DECK()] });

    const a = actor(client, game.id);
    let last;
    for (let map = 1; map <= 3; map++) {
      for (const step of MAP_STEPS) {
        last = await a.send(step);
        assert.equal(last.status, 200, JSON.stringify(last.body));
        assertNoSecrets(last.body, `map ${map} ${step.type}`);
      }
      if (map < 3) {
        assert.equal(last.body.game.mapIndex, map + 1);
        assert.equal(last.body.game.coins, map);
        assert.deepEqual(last.body.effects.map(e => e.type).slice(0, 4), ['pay', 'reveal', 'map_end', 'map_start']);
        assert.equal(last.body.effects[1].reward, 'coin');
        assert.equal(last.body.game.deckRemaining, 11, 'new map: fresh 16 cards, 5 dealt');
      }
    }

    const final = last.body.game;
    assert.equal(final.status, 'finished');
    assert.equal(final.reason, 'gold');
    assert.equal(final.score, 100);
    assert.equal(final.turn, 9, 'choose_branch is not an action');
    assert.equal(final.revision, 12, 'choose_branch still bumps revision');
    assert.deepEqual(final.completedMaps.map(m => m.result), ['coin', 'coin', 'gold']);
    assert.deepEqual(last.body.effects.map(e => e.type), ['pay', 'reveal', 'map_end', 'end']);

    const current = await client.get('/api/games/current');
    assert.equal(current.body.score, 100);
    assertNoSecrets(current.body, 'current');
  } finally {
    await close();
  }
});

test('route-v1: retrying a map-changing action replays the result and never redraws maps or cards', async () => {
  const { close, db, client, game } = await setup();
  try {
    scriptGame(db, game.id, { mapIds: [1, 2], goldMapIndex: 2, decks: [MAP_DECK(), deck('HHVVB')] });
    const a = actor(client, game.id);
    for (const step of MAP_STEPS.slice(0, 3)) assert.equal((await a.send(step)).status, 200);

    const body = { actionId: randomUUID(), expectedRevision: 3, type: 'pave', pay: { H: 1, V: 1 } };
    const first = await client.post(`/api/games/${game.id}/actions`, body);
    assert.equal(first.status, 200);
    assert.equal(first.body.game.mapIndex, 2);
    const eventsAfter = db.prepare('SELECT COUNT(*) AS n FROM events WHERE game_id = ?').get(game.id).n;

    const retry = await client.post(`/api/games/${game.id}/actions`, body);
    assert.equal(retry.status, 200);
    assert.deepEqual(retry.body.game.hand, first.body.game.hand);
    assert.equal(retry.body.game.mapId, first.body.game.mapId);
    assert.equal(retry.body.game.revision, first.body.game.revision);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM events WHERE game_id = ?').get(game.id).n, eventsAfter);

    const changed = await client.post(`/api/games/${game.id}/actions`, { ...body, pay: { H: 2 } });
    assert.equal(changed.status, 409);
    assert.equal(changed.body.error.code, 'IDEMPOTENCY_KEY_REUSE');
  } finally {
    await close();
  }
});

test('route-v1: creation idempotency covers the ruleset, and the payload cannot change the deck or scores', async () => {
  const server = await startTestServer();
  const client = makeClient(server.baseUrl);
  try {
    await client.post('/api/players');
    const key = randomUUID();
    const first = await client.post('/api/games', { ruleset: 'route-v1', config: { deck: { R: 0 } }, goldScore: 999 }, { 'Idempotency-Key': key });
    assert.equal(first.status, 201);
    assert.equal(first.body.configId, makeConfig().configId);
    assert.deepEqual(first.body.publicConfig.deck, { H: 4, V: 4, B: 2, X: 1, R: 5 });
    assert.equal(first.body.publicConfig.goldScore, 60);

    const replay = await client.post('/api/games', { ruleset: 'route-v1' }, { 'Idempotency-Key': key });
    assert.equal(replay.status, 201);
    assert.equal(replay.body.id, first.body.id);

    const otherRuleset = await client.post('/api/games', { ruleset: 'grid' }, { 'Idempotency-Key': key });
    assert.equal(otherRuleset.status, 409);
    assert.equal(otherRuleset.body.error.code, 'IDEMPOTENCY_KEY_REUSE');

    const inProgress = await client.post('/api/games', { ruleset: 'route-v1' });
    assert.equal(inProgress.status, 409);
    assert.equal(inProgress.body.error.code, 'GAME_IN_PROGRESS');
    assert.equal(inProgress.body.game.id, first.body.id);
    assertNoSecrets(inProgress.body, 'GAME_IN_PROGRESS');

    const bad = await client.post('/api/games', { ruleset: 'route-v2' });
    assert.equal(bad.status, 400);
  } finally {
    await server.close();
  }
});

test('route-v1: malformed (400) and illegal (422) actions consume nothing; a stale revision gets 409 + latest state', async () => {
  const { close, db, client, game } = await setup();
  try {
    scriptGame(db, game.id, { mapIds: [1], goldMapIndex: 1, decks: [MAP_DECK()] });
    const events = () => db.prepare('SELECT COUNT(*) AS n FROM events WHERE game_id = ?').get(game.id).n;
    const before = events();
    const post = body => client.post(`/api/games/${game.id}/actions`, { actionId: randomUUID(), expectedRevision: 0, ...body });

    for (const body of [
      { type: 'pave', pay: { H: 2, R: 1 } },
      { type: 'pave', pay: { H: -1 } },
      { type: 'pave' },
      { type: 'exchange', discard: 'R' },
      { type: 'choose_branch', branch: 'C' },
      { type: 'place', handIndex: 0, row: 2, col: 1 },
    ]) {
      assert.equal((await post(body)).status, 400, JSON.stringify(body));
    }
    for (const body of [
      { type: 'pave', pay: { H: 1 } },
      { type: 'pave', pay: { H: 4 } },
      { type: 'dig', pay: { H: 2 } },
      { type: 'choose_branch', branch: 'A' },
    ]) {
      const res = await post(body);
      assert.equal(res.status, 422, JSON.stringify(body));
      assert.equal(res.body.error.code, 'INVALID_ACTION');
    }

    const current = (await client.get('/api/games/current')).body;
    assert.equal(current.revision, 0);
    assert.equal(current.turn, 0);
    assert.deepEqual(current.hand, { H: 3, V: 2, B: 0, X: 0 });
    assert.equal(events(), before, 'no events were written');

    assert.equal((await post({ type: 'pave', pay: { H: 2 } })).status, 200);
    const stale = await post({ type: 'exchange', discard: 'V' });
    assert.equal(stale.status, 409);
    assert.equal(stale.body.error.code, 'REVISION_CONFLICT');
    assert.equal(stale.body.game.revision, 1);
    assert.equal(stale.body.game.phase, 'fork');
  } finally {
    await close();
  }
});

test('route-v1: strict deadline over HTTP — deadline-1 ms wins, deadline times out, and a confirmed actionId replays after it', async () => {
  const realNow = clock.now;
  const { close, db, client, game } = await setup();
  try {
    scriptGame(db, game.id, { mapIds: [1], goldMapIndex: 1, decks: [MAP_DECK()] });
    const deadline = getGame(db, game.id).deadlineAt;
    const a = actor(client, game.id);
    for (const step of MAP_STEPS.slice(0, 3)) assert.equal((await a.send(step)).status, 200);

    clock.now = () => deadline - 1;
    const winning = { actionId: randomUUID(), expectedRevision: 3, type: 'pave', pay: { H: 1, V: 1 } };
    const won = await client.post(`/api/games/${game.id}/actions`, winning);
    assert.equal(won.status, 200);
    assert.equal(won.body.game.reason, 'gold');

    clock.now = () => deadline + 10_000;
    const replay = await client.post(`/api/games/${game.id}/actions`, winning);
    assert.equal(replay.status, 200);
    assert.equal(replay.body.game.reason, 'gold', 'replay is a lookup of a completed action, not a new late action');
    assert.equal((await client.get('/api/games/current')).body.reason, 'gold');
  } finally {
    clock.now = realNow;
    await close();
  }

  const second = await setup();
  try {
    scriptGame(second.db, second.game.id, { mapIds: [1], goldMapIndex: 1, decks: [MAP_DECK()] });
    const deadline = getGame(second.db, second.game.id).deadlineAt;
    const a = actor(second.client, second.game.id);
    for (const step of MAP_STEPS.slice(0, 3)) assert.equal((await a.send(step)).status, 200);
    const handBefore = (await second.client.get('/api/games/current')).body.hand;

    clock.now = () => deadline;
    const late = await second.client.post(`/api/games/${second.game.id}/actions`, {
      actionId: randomUUID(), expectedRevision: 3, type: 'pave', pay: { H: 1, V: 1 },
    });
    assert.equal(late.status, 409);
    assert.equal(late.body.game.reason, 'timeout');
    assert.equal(late.body.game.score, 0);
    assert.equal(late.body.game.endedAt, deadline);
    assert.deepEqual(late.body.game.hand, handBefore, 'nothing was paid');
    const types = second.db.prepare('SELECT type FROM events WHERE game_id = ? ORDER BY seq').all(second.game.id).map(r => r.type);
    assert.ok(!types.includes('reveal'));
    assert.equal(types.at(-1), 'end');
  } finally {
    clock.now = realNow;
    await second.close();
  }
});

test('route-v1: hints are read-only, owner-only, match the formal analysis and are discarded by revision', async () => {
  const { close, db, client, baseUrl, game } = await setup();
  try {
    scriptGame(db, game.id, { mapIds: [1], goldMapIndex: 1, decks: [MAP_DECK()] });
    const eventsBefore = db.prepare('SELECT COUNT(*) AS n FROM events WHERE game_id = ?').get(game.id).n;

    const hints = await client.get(`/api/games/${game.id}/hints`);
    assert.equal(hints.status, 200);
    assert.equal(hints.headers.get('cache-control'), 'no-store');
    assert.equal(hints.body.revision, 0);
    assert.equal(hints.body.configId, game.configId);
    assert.equal(hints.body.source, 'exact_dp');
    assert.ok(hints.body.options.length > 0);
    assert.equal(hints.body.options.filter(o => o.best).length, 1);
    for (const o of hints.body.options) {
      assert.match(o.value.numerator, /^\d+$/);
      assert.ok(['pave', 'dig', 'exchange'].includes(o.action.type));
    }
    assertNoSecrets(hints.body, 'hints');

    const current = (await client.get('/api/games/current')).body;
    assert.equal(current.revision, 0, 'reading hints does not bump revision');
    assert.equal(current.turn, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM events WHERE game_id = ?').get(game.id).n, eventsBefore);

    // 實際打開提示的紀錄：lifecycle hint_shown，eventId 去重
    const eventId = randomUUID();
    for (let i = 0; i < 2; i++) {
      const shown = await client.post(`/api/games/${game.id}/lifecycle`, { type: 'hint_shown', eventId });
      assert.equal(shown.status, 200);
    }
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM events WHERE game_id = ? AND type = 'hint_shown'").get(game.id).n, 1);

    const stranger = makeClient(baseUrl);
    assert.equal((await stranger.get(`/api/games/${game.id}/hints`)).status, 401);
    await stranger.post('/api/players');
    assert.equal((await stranger.get(`/api/games/${game.id}/hints`)).status, 404);
    assert.equal((await stranger.post(`/api/games/${game.id}/actions`, {
      actionId: randomUUID(), expectedRevision: 1, type: 'pave', pay: { H: 2 },
    })).status, 404);

    // 岔路提示是 A/B 的選擇
    const a = actor(client, game.id);
    a.revision = 1;
    await a.send({ type: 'pave', pay: { H: 2 } });
    const fork = (await client.get(`/api/games/${game.id}/hints`)).body;
    assert.deepEqual(fork.options.map(o => o.action), [{ type: 'choose_branch', branch: 'A' }, { type: 'choose_branch', branch: 'B' }]);
    assert.equal(fork.revision, 2);
  } finally {
    await close();
  }
});

test('route-v1: public stats separate maps from games; CSVs carry route columns and hide the gold map while playing', async () => {
  const { close, db, client, game } = await setup();
  try {
    scriptGame(db, game.id, { mapIds: [1, 1], goldMapIndex: 2, decks: [MAP_DECK(), MAP_DECK()] });
    const a = actor(client, game.id);
    for (const step of MAP_STEPS) await a.send(step);

    const [playing] = parseCsv((await client.get('/api/admin/export.csv?ruleset=route-v1')).body);
    assert.equal(playing.ruleset, 'route-v1');
    assert.equal(playing.configId, makeConfig().configId);
    assert.equal(playing.status, 'playing');
    assert.equal(playing.goldMapIndex, '', 'gold map hidden while the game is in progress');
    assert.equal(playing.goldRow, '');
    assert.equal(playing.mapIndex, '2');
    assert.equal(playing.mapSequence, '1,1');

    for (const step of MAP_STEPS) await a.send(step);

    const stats = (await client.get('/api/admin/stats?ruleset=route-v1')).body;
    assert.equal(stats.games, 1);
    assert.equal(stats.maps.played, 2, 'two maps in one game is still one game');
    assert.equal(stats.maps.passed, 2);
    assert.deepEqual(stats.maps.byMapId, { 1: { played: 2, passed: 2, passRate: 1 } });
    assert.deepEqual(stats.byScore, { 80: 1 });

    const [finished] = parseCsv((await client.get('/api/admin/export.csv?ruleset=route-v1')).body);
    assert.equal(finished.goldMapIndex, '2');
    assert.equal(finished.score, '80');

    const events = parseCsv((await client.get('/api/admin/events.csv?ruleset=route-v1')).body);
    const pays = events.filter(e => e.type === 'pay');
    assert.equal(pays.length, 6);
    assert.deepEqual(
      { action: pays[0].action, payH: pays[0].payH, handH: pays[0].handH, deckR: pays[0].deckR, mapIndex: pays[0].mapIndex, mapId: pays[0].mapId, pos: pays[0].pos, segment: pays[0].segment, a: pays[0].a },
      { action: 'pave', payH: '2', handH: '3', deckR: '5', mapIndex: '1', mapId: '1', pos: 'F', segment: 'HH', a: '0' },
    );
    assert.ok(Number(pays[0].decisionMs) >= 0);
    const choose = events.find(e => e.type === 'choose_branch');
    assert.equal(choose.branch, 'B');
    assert.equal(choose.action, 'choose_branch');
    assert.deepEqual(events.filter(e => e.type === 'draw').slice(0, 5).map(e => e.cardId), ['H', 'H', 'H', 'V', 'V']);
    assert.deepEqual(events.filter(e => e.type === 'map_end').map(e => e.result), ['coin', 'gold']);

    assert.equal((await client.get('/api/admin/stats?ruleset=grid')).body.games, 0, 'rulesets never mix');
  } finally {
    await close();
  }
});

test('route-v1: /api/route/analysis is public and exact; /shared serves only the whitelisted modules', async () => {
  const { close, client } = await setup();
  try {
    const res = await client.get('/api/route/analysis');
    assert.equal(res.status, 200);
    assert.match(res.headers.get('cache-control'), /public/);
    assert.deepEqual(res.body.p, { numerator: '125831', denominator: '206388', decimal: '0.609682' });
    assert.equal(res.body.source, 'exact_dp');
    assert.equal(res.body.configId, makeConfig().configId);

    for (const name of ['rational.js', 'route-config.js', 'route-engine.js', 'route-analysis.js']) {
      const mod = await client.get(`/shared/${name}`);
      assert.equal(mod.status, 200, name);
      assert.match(mod.headers.get('content-type'), /javascript/);
    }
    for (const path of ['/shared/', '/shared/nope.js', '/shared/../backend/.env', '/shared/%2e%2e/backend/src/db.js', '/shared/../backend/data/game.db']) {
      const r = await client.get(path);
      assert.ok([403, 404].includes(r.status), `${path} → ${r.status}`);
    }
  } finally {
    await close();
  }
});
