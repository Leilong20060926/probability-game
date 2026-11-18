import {test} from 'node:test';
import assert from 'node:assert/strict';
import {startTestServer,makeClient} from './helpers.js';
import {exportGameRows,exportEventRows,gameStats} from '../src/admin-repo.js';

test('nickname survives actions/current/replay and CSV, remains a snapshot, and never replaces player identity',async()=>{
  const s=await startTestServer(),client=makeClient(s.baseUrl),other=makeClient(s.baseUrl);
  try{
    await client.post('/api/players');
    const body={ruleset:'route-v1',nickname:'  小礦工🌟  '},headers={'Idempotency-Key':'named'};
    const created=await client.post('/api/games',body,headers),game=created.body;
    assert.equal(created.status,201);assert.equal(game.playerNickname,'小礦工🌟');
    const ended=await client.post(`/api/games/${game.id}/actions`,{type:'abandon',actionId:'end',expectedRevision:0});
    assert.equal(ended.body.game.playerNickname,'小礦工🌟');
    assert.equal((await client.get('/api/games/current')).body.playerNickname,'小礦工🌟');
    assert.equal((await client.post('/api/games',body,headers)).body.playerNickname,'小礦工🌟');
    assert.equal((await client.post('/api/games',{...body,nickname:'改名'},headers)).status,409);
    const second=await client.post('/api/games',{ruleset:'route-v1',nickname:'另一個暱稱'},{'Idempotency-Key':'second'});
    assert.equal(second.body.playerId,game.playerId);assert.equal(second.body.attempt,2);
    await other.post('/api/players');
    const third=await other.post('/api/games',{ruleset:'route-v1',nickname:'小礦工🌟'},{'Idempotency-Key':'other'});
    assert.notEqual(third.body.playerId,game.playerId,'identical nicknames cannot merge identities');
    assert.equal((await other.get(`/api/games/${game.id}/hints`)).status,404);
    const list=(await client.get('/api/admin/games')).body.games;
    assert.equal(list.find(row=>row.id===game.id).playerNickname,'小礦工🌟');
    assert.equal(list.find(row=>row.id===second.body.id).playerNickname,'另一個暱稱');
    assert.equal(gameStats(s.db,{}).players,2);
    for(const rows of [exportGameRows(s.db,{}),exportEventRows(s.db,{})]){
      const first=rows.find(row=>row.gameId===game.id);assert.equal(first.playerNickname,'小礦工🌟');assert.equal(first.playerId,game.playerId);
    }
    for(const endpoint of ['export','events']){
      const csv=await fetch(s.baseUrl+`/api/admin/${endpoint}.csv`).then(r=>r.text());
      assert.match(csv,/playerNickname/);assert.match(csv,/小礦工🌟/);
    }
  }finally{await s.close();s.db.close();}
});

test('nickname validation rejects invalid input without creating records, accepts Unicode and preserves anonymous compatibility',async()=>{
  const s=await startTestServer(),client=makeClient(s.baseUrl);
  try{
    await client.post('/api/players');
    for(const nickname of ['', '   ', 'a'.repeat(21), 'a\nb', 'a\u0000b', 123, null,{}]){
      const response=await client.post('/api/games',{ruleset:'route-v1',nickname},{'Idempotency-Key':'invalid'});
      assert.equal(response.status,400,JSON.stringify(nickname));
    }
    assert.equal(gameStats(s.db,{}).games,0);
    const unicode=await client.post('/api/games',{ruleset:'route-v1',nickname:'🌟'.repeat(20)},{'Idempotency-Key':'unicode'});
    assert.equal(unicode.status,201);assert.equal(unicode.body.attempt,1);
    await client.post(`/api/games/${unicode.body.id}/actions`,{type:'abandon',actionId:'end',expectedRevision:0});
    const anonymous=await client.post('/api/games',{}, {'Idempotency-Key':'legacy'});
    assert.equal(anonymous.status,201);assert.equal(anonymous.body.playerNickname,null);
    await client.post('/api/players/switch');
    const formula=await client.post('/api/games',{ruleset:'route-v1',nickname:'=1+1'},{'Idempotency-Key':'formula'});
    assert.equal(formula.status,201);
    for(const endpoint of ['export','events'])assert.match(await fetch(s.baseUrl+`/api/admin/${endpoint}.csv`).then(r=>r.text()),/'=1\+1/);
  }finally{await s.close();s.db.close();}
});
