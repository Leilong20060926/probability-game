import { test } from 'node:test';
import assert from 'node:assert/strict';

import { openDb } from '../src/db.js';
import { toCsv } from '../src/csv.js';
import { createPlayer } from '../src/players-repo.js';
import { insertGame } from '../src/games-repo.js';
import { gameStats, listGames } from '../src/admin-repo.js';
import { newGame } from '../src/engine-adapter.js';

test('toCsv adds a BOM, quotes fields with commas, and guards formula injection', () => {
  const csv = toCsv(['a', 'b'], [
    { a: 'hello, world', b: '=cmd|"/c calc"!A1' },
    { a: 'line\nbreak', b: null },
  ]);

  assert.ok(csv.startsWith('﻿'));
  assert.ok(csv.includes('"hello, world"'));
  assert.ok(csv.includes("'=cmd"), '公式注入前綴應被加上單引號');
  assert.ok(csv.includes('"line\nbreak"'));
});

test('gameStats returns zero/null (never NaN) on an empty database', () => {
  const db = openDb(':memory:');
  const stats = gameStats(db, {});

  assert.equal(stats.games, 0);
  assert.equal(stats.players, 0);
  assert.equal(stats.goldFinishRate, null);
  assert.equal(stats.avgScore, null);
  assert.equal(stats.avgDurationMs, null);
  assert.deepEqual(stats.byReason, {});
});

test('gameStats distinguishes game count from distinct player count and aggregates by reason', () => {
  const db = openDb(':memory:');
  const now = 1_000_000;

  const playerA = createPlayer(db, now);
  const playerB = createPlayer(db, now);

  const gold = newGame(playerA.id, 1, () => 0.1, now);
  gold.status = 'finished';
  gold.reason = 'gold';
  gold.score = 80;
  gold.coins = 1;
  gold.endedAt = now + 60_000;
  insertGame(db, gold, null, now);

  const timeout = newGame(playerA.id, 2, () => 0.1, now);
  timeout.status = 'finished';
  timeout.reason = 'timeout';
  timeout.score = 0;
  timeout.endedAt = now + 300_000;
  insertGame(db, timeout, null, now);

  const playing = newGame(playerB.id, 1, () => 0.1, now);
  insertGame(db, playing, null, now);

  const stats = gameStats(db, {});
  assert.equal(stats.games, 3);
  assert.equal(stats.players, 2);
  assert.equal(stats.finished, 2);
  assert.equal(stats.byReason.gold, 1);
  assert.equal(stats.byReason.timeout, 1);
  assert.equal(stats.goldFinishRate, 1 / 3);
  assert.equal(stats.avgScore, 40);

  const finishedOnly = gameStats(db, { status: 'finished' });
  assert.equal(finishedOnly.games, 2);

  const listed = listGames(db, { status: 'finished' }, 1, 10);
  assert.equal(listed.total, 2);
  assert.equal(listed.games.length, 2);
});
