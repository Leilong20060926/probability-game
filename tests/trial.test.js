import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createTrial} from '../frontend/src/trial.js';

test('disposable practice has isolated memory state and never needs storage or network', async () => {
  const originals = Object.fromEntries(['fetch','localStorage','sessionStorage'].map(k => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
  globalThis.fetch = () => {throw new Error('practice must not use network');};
  for (const key of ['localStorage','sessionStorage']) Object.defineProperty(globalThis, key, {
    configurable:true, value:new Proxy({}, {get(){throw new Error('practice must not persist');}}),
  });
  try {
    const trial = createTrial();
    const player = await trial('/api/players');
    const game = await trial('/api/games');
    assert.equal(game.mode,'trial');
    assert.equal(game.hand.length,5);
    assert.equal(game.deckRemaining,17);
    assert.ok(!('goldRow' in game) && !('deck' in game));
    const played = await trial(`/api/games/${game.id}/actions`, {body:{type:'discard',handIndex:0}});
    assert.equal(played.game.turn,1);
    const finished = await trial(`/api/games/${game.id}/actions`, {body:{type:'abandon'}});
    assert.equal(finished.game.reason,'abandoned');
    assert.equal(finished.game.score,0);
    assert.equal((await trial('/api/games')).attempt,2);
    const newPage = createTrial();
    assert.equal(await newPage('/api/games/current'), null, 'new page must not recover practice data');
    await trial('/api/players/switch');
    assert.equal(await trial('/api/games/current'),null);
    assert.notEqual((await trial('/api/players')).playerId,player.playerId);
  } finally {
    for (const [key,descriptor] of Object.entries(originals)) {
      if (descriptor === undefined) delete globalThis[key]; else Object.defineProperty(globalThis,key,descriptor);
    }
  }
});
