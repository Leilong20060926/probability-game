// 0002 遷移：在「只套用過 0001」的檔案資料庫上執行，舊格子版資料必須完整保留、
// 仍可讀可匯出，且不會被重標成新規則；新舊規則的進行中局各自依版本收尾。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { openDb } from '../src/db.js';
import { getGame, insertGame, insertEvents } from '../src/games-repo.js';
import { exportGameRows, exportEventRows, gameStats } from '../src/admin-repo.js';
import { finalizeStaleVersionGames } from '../src/stale-games.js';
import { createPlayer } from '../src/players-repo.js';
import { newGame, act, VERSION, newRouteGame, ROUTE_VERSION } from '../src/engine-adapter.js';

const init = readFileSync(fileURLToPath(new URL('../migrations/0001_init.sql', import.meta.url)), 'utf8');

function legacyDb(path) {
  const raw = new DatabaseSync(path);
  raw.exec('PRAGMA foreign_keys = ON;');
  raw.exec('CREATE TABLE schema_migrations (name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL);');
  raw.exec(init);
  raw.prepare("INSERT INTO schema_migrations VALUES ('0001_init.sql', 1)").run();
  raw.prepare("INSERT INTO players (id, attempt_counter, created_at) VALUES ('old-player', 2, 1)").run();

  const insert = (game, status) => {
    raw.prepare(`
      INSERT INTO games (id, player_id, attempt, version, revision, source, mode, status, reason,
        started_at, ended_at, score, coins, turn, gold_row, device_type, state_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'human', 'server', ?, ?, ?, ?, ?, ?, ?, ?, 'touch', ?, ?, ?)
    `).run(game.id, game.playerId, game.attempt, game.version, 3, status, game.reason ?? null,
      game.startedAt, game.endedAt, game.score, game.coins, game.turn, game.goldRow, JSON.stringify(game),
      game.startedAt, game.startedAt);
    raw.prepare(`
      INSERT INTO events (game_id, seq, turn, type, elapsed_ms, decision_ms, card_id, row, col, hand_count, deck_count)
      VALUES (?, 1, 1, 'discard', 10, 10, 'cross', NULL, NULL, 5, 13)
    `).run(game.id);
  };

  const finished = newGame('old-player', 1, () => 0.3, 1000);
  finished.id = 'old-finished';
  finished.status = 'finished';
  finished.reason = 'exhausted';
  finished.endedAt = 5000;
  insert(finished, 'finished');

  const playing = newGame('old-player', 2, () => 0.6, 2000);
  playing.id = 'old-playing';
  insert(playing, 'playing');

  raw.close();
  return { finished, playing };
}

test('0002 keeps every legacy grid game and event, readable and exportable, and labels them grid', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mine-migrate-'));
  const path = join(dir, 'game.db');
  try {
    const legacy = legacyDb(path);
    const db = openDb(path);

    assert.deepEqual(db.prepare('SELECT name FROM schema_migrations ORDER BY name').all().map(r => r.name),
      ['0001_init.sql', '0002_route_v1.sql']);
    assert.equal(db.prepare('PRAGMA foreign_keys').get().foreign_keys, 1, 'foreign keys back on after migrating');
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);

    const rows = db.prepare('SELECT id, ruleset, version, revision, gold_row, device_type, config_id FROM games ORDER BY id').all();
    assert.deepEqual(rows.map(r => ({ ...r })), [
      { id: 'old-finished', ruleset: 'grid', version: legacy.finished.version, revision: 3, gold_row: legacy.finished.goldRow, device_type: 'touch', config_id: null },
      { id: 'old-playing', ruleset: 'grid', version: legacy.playing.version, revision: 3, gold_row: legacy.playing.goldRow, device_type: 'touch', config_id: null },
    ]);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM events').get().n, 2);

    // 舊局可以照舊規則繼續讀寫
    const old = getGame(db, 'old-playing');
    assert.equal(old.ruleset, 'grid');
    assert.ok(Array.isArray(old.hand) && old.board);
    assert.equal(act(old, 0, null, 2500), true);

    const exported = exportGameRows(db, {});
    assert.equal(exported.length, 2);
    const fin = exported.find(r => r.gameId === 'old-finished');
    assert.equal(fin.ruleset, 'grid');
    assert.equal(fin.goldRow, legacy.finished.goldRow, 'old finished rows still export goldRow');
    assert.equal(fin.goldMapIndex, null);
    assert.equal(exported.find(r => r.gameId === 'old-playing').goldRow, null, 'hidden while still playing');
    const events = exportEventRows(db, { ruleset: 'grid' });
    assert.equal(events.length, 2);
    assert.equal(events[0].cardId, 'cross');
    assert.equal(events[0].mapIndex, null);

    // 新規則的局寫進同一個 DB，統計依 ruleset 分開
    const player = createPlayer(db, 9000);
    const route = newRouteGame({ playerId: player.id, attempt: 1, now: 9000 });
    insertGame(db, route, null, 9000);
    insertEvents(db, route.id, route.events, 0);
    assert.equal(gameStats(db, { ruleset: 'grid' }).games, 2);
    assert.equal(gameStats(db, { ruleset: 'route-v1' }).games, 1);
    assert.equal(gameStats(db, { ruleset: 'route-v1', version: ROUTE_VERSION }).games, 1);
    db.close();

    // 重開不會重跑遷移
    const again = openDb(path);
    assert.equal(again.prepare('SELECT COUNT(*) AS n FROM games').get().n, 3);
    again.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('startup cleanup compares versions per ruleset: current grid and route games survive, outdated ones end', () => {
  const db = openDb(':memory:');
  const player = createPlayer(db, 1);

  const grid = newGame(player.id, 1, () => 0.3, 1000);
  insertGame(db, grid, null, 1000);

  const route = newRouteGame({ playerId: player.id, attempt: 2, now: 1000 });
  insertGame(db, route, null, 1000);

  const oldRoute = newRouteGame({ playerId: player.id, attempt: 3, now: 1000 });
  oldRoute.version = '0.3.9-route';
  insertGame(db, oldRoute, null, 1000);

  const oldGrid = newGame(player.id, 4, () => 0.3, 1000);
  oldGrid.version = '0.1.0';
  insertGame(db, oldGrid, null, 1000);

  assert.equal(finalizeStaleVersionGames(db, undefined, 2000), 2);

  assert.equal(getGame(db, grid.id).status, 'playing', `grid ${VERSION} is current`);
  assert.equal(getGame(db, route.id).status, 'playing', `route ${ROUTE_VERSION} is current — must not be ended by the grid version check`);
  const endedRoute = getGame(db, oldRoute.id);
  assert.equal(endedRoute.reason, 'abandoned');
  assert.equal(endedRoute.version, '0.3.9-route', 'version is never relabeled');
  assert.equal(getGame(db, oldGrid.id).reason, 'abandoned');
});
