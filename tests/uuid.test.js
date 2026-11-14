import {test} from 'node:test';
import assert from 'node:assert/strict';
import {uuid} from '../frontend/src/uuid.js';
import {createTrial} from '../frontend/src/trial.js';
import {createGameRequest,actionRequest,lifecycleRequest} from '../frontend/src/storage.js';

test('LAN HTTP without crypto.randomUUID supports practice and request identifiers using secure random bytes', async () => {
  const original=Object.getOwnPropertyDescriptor(globalThis,'crypto');
  const random=globalThis.crypto.getRandomValues.bind(globalThis.crypto);
  let calls=0;
  Object.defineProperty(globalThis,'crypto',{configurable:true,value:{getRandomValues(bytes){calls++;return random(bytes);}}});
  const pattern=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  try {
    assert.match(uuid(),pattern);
    const trial=createTrial();
    assert.match((await trial('/api/players')).playerId,pattern);
    const game=await trial('/api/games');
    assert.match(game.id,pattern);
    const result=await trial(`/api/games/${game.id}/actions`,{body:{type:'discard',handIndex:0}});
    assert.equal(result.game.turn,1);
    assert.match(createGameRequest('touch').options.headers['Idempotency-Key'],pattern);
    assert.match(actionRequest(game,'discard',0).options.body.actionId,pattern);
    assert.match(lifecycleRequest(game,'visible').options.body.eventId,pattern);
    assert.equal(calls,6);
  } finally {Object.defineProperty(globalThis,'crypto',original);}
});
