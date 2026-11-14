// Isolated review reproduction, never uses backend/.env or the real database.
import http from 'node:http';
import assert from 'node:assert/strict';
import {startTestServer, makeClient} from '../backend/tests/helpers.js';
import {issuePlayerSession} from '../backend/src/session.js';

const instance = await startTestServer();
const client = makeClient(instance.baseUrl);
try {
  await client.post('/api/players');
  const game = (await client.post('/api/games', {}, {'Idempotency-Key':crypto.randomUUID()})).body;
  // Hold request body open. The backend has already loaded revision 0.
  const delayedBody = JSON.stringify({actionId:crypto.randomUUID(),expectedRevision:0,type:'discard',handIndex:99});
  let delayed;
  const completed = new Promise((resolve, reject) => {
    delayed = http.request(instance.baseUrl + `/api/games/${game.id}/actions`, {
      method:'POST', headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(delayedBody),
        Cookie:Object.entries(client.cookies).map(([k,v]) => `${k}=${v}`).join('; ')},
    }, response => {
      let text = '';
      response.on('data', c => text += c);
      response.on('end', () => resolve({status:response.statusCode,body:JSON.parse(text)}));
    });
    delayed.on('error', reject);
    delayed.flushHeaders();
  });
  // Allow the server to receive the headers and enter the body wait before the second request.
  await new Promise(resolve => {
    const poll = () => {
      instance.server.getConnections((_, n) => {
        if (n > 0) setTimeout(resolve, 30); else setTimeout(poll, 5);
      });
    };
    poll();
  });
  const valid = await client.post(`/api/games/${game.id}/actions`, {
    actionId:crypto.randomUUID(),expectedRevision:0,type:'discard',handIndex:0,
  });
  assert.equal(valid.status, 200);
  assert.equal(valid.body.game.turn, 1);
  const eventsAfterValid = instance.db.prepare('SELECT COUNT(*) AS n FROM events WHERE game_id = ?').get(game.id).n;
  delayed.end(delayedBody);
  const invalid = await completed;
  const current = await client.get('/api/games/current');
  const eventCount = instance.db.prepare('SELECT COUNT(*) AS n FROM events WHERE game_id = ?').get(game.id).n;
  console.log(JSON.stringify({validTurn:valid.body.game.turn, delayedStatus:invalid.status,
    finalTurn:current.body.turn,finalRevision:current.body.revision,eventCount}, null, 2));
  assert.equal(invalid.status, 409);
  assert.equal(invalid.body.error.code, 'REVISION_CONFLICT');
  assert.equal(current.body.turn, valid.body.game.turn);
  assert.equal(current.body.revision, valid.body.game.revision);
  assert.equal(eventCount, eventsAfterValid);
  console.log('VERIFIED: delayed request conflicts; acknowledged state and event count are preserved.');

  // server.main loads .env after its static imports, so simulate that order.
  const oldSecure = process.env.COOKIE_SECURE;
  process.env.COOKIE_SECURE = 'true';
  const headers = new Map();
  issuePlayerSession(instance.db, {
    getHeader:name=>headers.get(name), setHeader:(name,value)=>headers.set(name,value),
  }, game.playerId);
  const cookieHasSecure = headers.get('Set-Cookie').every(c=>c.includes('; Secure'));
  console.log(JSON.stringify({secureConfiguredAfterImport:true, cookieHasSecure}));
  assert.equal(cookieHasSecure, true);
  if (oldSecure === undefined) delete process.env.COOKIE_SECURE; else process.env.COOKIE_SECURE = oldSecure;
} finally {
  await instance.close();
  instance.db.close();
}
