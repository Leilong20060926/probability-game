import {test} from 'node:test';
import assert from 'node:assert/strict';
import {startTestServer} from '../backend/tests/helpers.js';
import {api, ApiError, createGameRequest, actionRequest, lifecycleRequest, publicBoard} from '../frontend/src/storage.js';
import {getGame,saveGame} from '../backend/src/games-repo.js';
import {actionNotice} from '../frontend/src/effects.js';

test('frontend transport: lost response retry, revision recovery, player isolation and anonymous records/CSV', async () => {
  const server = await startTestServer();
  const originalFetch = globalThis.fetch;
  const cookies = new Map();
  let loseResponse = false;
  globalThis.fetch = async (path, options) => {
    const response = await originalFetch(server.baseUrl + path, {
      ...options, headers:{...options.headers, Cookie:[...cookies].map(([k,v]) => `${k}=${v}`).join('; ')},
    });
    for (const cookie of response.headers.getSetCookie()) {
      const [key, value] = cookie.split(';')[0].split('=');
      cookies.set(key, value);
    }
    if (loseResponse) { loseResponse = false; throw new TypeError('simulated lost response'); }
    return response;
  };
  try {
    for (const path of ['/', '/admin.html', '/src/app.js', '/src/admin.js', '/src/storage.js', '/src/style.css', '/src/workspace.js', '/src/analysis.js', '/src/effects.js']) {
      assert.equal((await originalFetch(server.baseUrl + path)).status, 200, path);
    }
    assert.equal((await api('/api/admin/stats')).games,0);
    assert.equal((await api('/api/admin/games')).total,0);
    for (const name of ['export','events']) {
      assert.match(await (await api(`/api/admin/${name}.csv`,{raw:true})).text(),/gameId/);
    }
    await api('/api/players', {body:{}});
    const create = createGameRequest('pointer');
    loseResponse = true;
    await assert.rejects(api(create.path, create.options), /lost response/);
    const game = await api(create.path, create.options);
    assert.equal((await api('/api/games/current')).id, game.id);
    assert.equal(game.mode, 'server');
    assert.ok(!('goldRow' in game) && !('deck' in game));
    assert.ok(game.targets.every(t => !('reward' in t)));
    assert.deepEqual(publicBoard(game), {});
    await assert.rejects(api('/api/games', {body:{}}), error => error.code === 'GAME_IN_PROGRESS');
    const action = actionRequest(game, 'discard', 0);
    loseResponse = true;
    await assert.rejects(api(action.path, action.options), /lost response/);
    const response = await api(action.path, action.options);
    assert.equal(response.game.turn, 1);
    assert.equal((await api('/api/games/current')).turn, 1);
    const stale = actionRequest(game, 'discard', 0);
    await assert.rejects(api(stale.path, stale.options), error => error instanceof ApiError && error.code === 'REVISION_CONFLICT' && error.game.turn === 1);
    const beforeLifecycle = await api('/api/games/current');
    const lifecycle = lifecycleRequest(beforeLifecycle, 'hidden');
    const eventsBefore = server.db.prepare('SELECT COUNT(*) AS n FROM events').get().n;
    loseResponse = true;
    await assert.rejects(api(lifecycle.path, lifecycle.options), /lost response/);
    const recorded = await api(lifecycle.path, lifecycle.options);
    assert.equal(recorded.game.revision, beforeLifecycle.revision + 1);
    assert.equal(server.db.prepare('SELECT COUNT(*) AS n FROM events').get().n, eventsBefore + 1);
    assert.equal((await api('/api/games/current')).revision, recorded.game.revision);
    // Deterministic in-memory fixture for the changed public effect contract.
    const fixture=getGame(server.db,game.id);
    fixture.board={'2,1':'horizontal','2,2':'horizontal','2,3':'horizontal'};
    fixture.placed=Object.keys(fixture.board);
    fixture.goldRow=0;
    fixture.hand=['horizontal'];
    fixture.deck=['rock','rock','vertical'];
    fixture.coins=0;
    fixture.revealed=[];
    saveGame(server.db,fixture,Date.now());
    const beforePlace=await api('/api/games/current');
    const place=actionRequest(beforePlace,'place',0,[2,4]);
    const rolledBack=await api(place.path,place.options);
    assert.deepEqual(rolledBack.effects.filter(e=>e.type==='unreveal'),[{type:'unreveal',row:2}]);
    assert.equal(rolledBack.game.coins,0);
    assert.deepEqual(rolledBack.game.targets.find(t=>t.row===2),{row:2,revealed:false});
    assert.match(actionNotice(rolledBack.effects),/金幣已扣回/);
    const eventCount=server.db.prepare('SELECT COUNT(*) AS n FROM events').get().n;
    assert.deepEqual(await api(place.path,place.options),rolledBack);
    assert.equal(server.db.prepare('SELECT COUNT(*) AS n FROM events').get().n,eventCount);
    const latest = await api('/api/games/current');
    const end = actionRequest(latest, 'abandon');
    const finished = (await api(end.path, end.options)).game;
    assert.equal(finished.reason, 'abandoned');
    assert.ok(finished.targets.every(t => !('reward' in t)));
    await api('/api/players/switch', {body:{}});
    assert.equal(await api('/api/games/current'), null);
    await assert.rejects(api(end.path, end.options), error => error.status === 404);
    cookies.clear(); // No player or admin cookie for any aggregate/export read.
    assert.equal((await api('/api/admin/games')).total, 1);
    assert.equal((await api('/api/admin/stats')).finished, 1);
    for (const name of ['export','events']) {
      const blob = await api(`/api/admin/${name}.csv?mode=server`, {raw:true});
      assert.match(await blob.text(), /gameId/);
    }
  } finally {
    globalThis.fetch = originalFetch;
    await server.close();
    server.db.close();
  }
});
