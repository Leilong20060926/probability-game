import { test } from 'node:test';
import assert from 'node:assert/strict';

import { openDb } from '../src/db.js';
import { createPlayer } from '../src/players-repo.js';
import { getGame, insertGame } from '../src/games-repo.js';
import { newGame } from '../src/engine-adapter.js';
import { finalizeStaleVersionGames } from '../src/stale-games.js';

// 迴歸測試：Codex review 發現新舊規則都標同一個 VERSION，統計無法分開；
// 也要處理規則變更當下還在玩的舊局，不能讓它用新規則繼續跑。
test('a playing game tagged with an older version gets finalized as abandoned on startup', () => {
  const db = openDb(':memory:');
  const now = 1_000_000;

  const player = createPlayer(db, now);
  const game = newGame(player.id, 1, () => 0.3, now);
  game.version = '0.1.0'; // 模擬規則變更前就建立、還在玩的舊局
  insertGame(db, game, null, now);

  const finalized = finalizeStaleVersionGames(db, '0.2.0', now + 5_000);
  assert.equal(finalized, 1);

  const reloaded = getGame(db, game.id);
  assert.equal(reloaded.status, 'finished');
  assert.equal(reloaded.reason, 'abandoned');
  assert.equal(reloaded.score, 0);
  assert.equal(reloaded.version, '0.1.0', '版本欄位保留原值，之後統計才能篩出受影響的舊局');
  assert.ok(reloaded.events.some(e => e.type === 'end'));
});

test('a stale game already past its deadline is finalized as timeout, not abandoned', () => {
  const db = openDb(':memory:');
  const now = 2_000_000;

  const player = createPlayer(db, now);
  const game = newGame(player.id, 1, () => 0.3, now);
  game.version = '0.1.0';
  insertGame(db, game, null, now);

  const finalized = finalizeStaleVersionGames(db, '0.2.0', now + 301_000);
  assert.equal(finalized, 1);

  const reloaded = getGame(db, game.id);
  assert.equal(reloaded.reason, 'timeout', '逾時判定優先於版本收尾判定的 abandoned');
});

test('a game already on the current version is left untouched', () => {
  const db = openDb(':memory:');
  const now = 3_000_000;

  const player = createPlayer(db, now);
  const game = newGame(player.id, 1, () => 0.3, now);
  insertGame(db, game, null, now); // record.version 已是目前引擎版本

  const finalized = finalizeStaleVersionGames(db, game.version, now + 5_000);
  assert.equal(finalized, 0);

  const reloaded = getGame(db, game.id);
  assert.equal(reloaded.status, 'playing');
});

test('a finished game of an old version is not touched (only status=playing matters)', () => {
  const db = openDb(':memory:');
  const now = 4_000_000;

  const player = createPlayer(db, now);
  const game = newGame(player.id, 1, () => 0.3, now);
  game.version = '0.1.0';
  game.status = 'finished';
  game.reason = 'exhausted';
  insertGame(db, game, null, now);

  const finalized = finalizeStaleVersionGames(db, '0.2.0', now + 5_000);
  assert.equal(finalized, 0);
});
