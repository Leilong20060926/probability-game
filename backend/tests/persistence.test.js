import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { openDb } from '../src/db.js';
import { createPlayer } from '../src/players-repo.js';
import { insertGame, getGame } from '../src/games-repo.js';
import { newGame } from '../src/engine-adapter.js';

test('data survives closing and reopening the database file (simulated restart)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mine-backend-'));
  const dbPath = join(dir, 'test.db');

  try {
    const db1 = openDb(dbPath);
    const now = 5_000_000;
    const player = createPlayer(db1, now);
    const game = newGame(player.id, 1, () => 0.3, now);
    insertGame(db1, game, 'touch', now);
    db1.close();

    const db2 = openDb(dbPath);
    const reloaded = getGame(db2, game.id);

    assert.ok(reloaded);
    assert.equal(reloaded.playerId, player.id);
    assert.equal(reloaded.startedAt, now);
    assert.deepEqual(reloaded.hand, game.hand);
    assert.equal(reloaded.deck.length, game.deck.length);
    db2.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
