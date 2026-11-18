import {test} from 'node:test';
import assert from 'node:assert/strict';
import {startTestServer,makeClient} from './helpers.js';
import {deleteGameRecord} from '../src/admin-repo.js';
import {getGame,saveGame,insertEvents} from '../src/games-repo.js';
import {newRouteGame} from '../../shared/route-engine.js';

async function setup(){const server=await startTestServer(),client=makeClient(server.baseUrl);await client.post('/api/players');return {...server,client};}
const remove=(server,id)=>fetch(`${server.baseUrl}/api/admin/games/${id}`,{method:'DELETE'});

test('public deletion removes a completed route, events and replay data, updates stats/CSVs and preserves other games',async()=>{
  const s=await setup();
  try{
    const grid=(await s.client.post('/api/games',{}, {'Idempotency-Key':'keep-grid'})).body;
    await s.client.post(`/api/games/${grid.id}/actions`,{type:'abandon',actionId:'end-grid',expectedRevision:0});
    const body={ruleset:'route-v1'},headers={'Idempotency-Key':'delete-route'};
    const route=(await s.client.post('/api/games',body,headers)).body;
    // A reproducible full route through the real HTTP action endpoints.
    const counts={H:4,V:4,B:2,X:1,R:5},prefix=[...'HHHVVXBHV'];for(const t of prefix)counts[t]--;
    const deck=[...prefix,...Object.entries(counts).flatMap(([t,n])=>Array(n).fill(t))];
    const old=getGame(s.db,route.id),fixture=newRouteGame({id:route.id,playerId:old.playerId,attempt:old.attempt,now:old.startedAt,script:{mapIds:[1],goldMapIndex:1,decks:[deck]}});
    fixture.mode='server';fixture.revision=0;s.db.prepare('DELETE FROM events WHERE game_id = ?').run(route.id);insertEvents(s.db,route.id,fixture.events,0);saveGame(s.db,fixture,old.startedAt);
    let revision=0;
    const steps=[{type:'pave',pay:{H:2}},{type:'choose_branch',branch:'B'},{type:'pave',pay:{H:1,X:1}},{type:'pave',pay:{H:1,V:1}}];
    for(const [i,step] of steps.entries()){const res=await s.client.post(`/api/games/${route.id}/actions`,{...step,actionId:'step-'+i,expectedRevision:revision});assert.equal(res.status,200);revision=res.body.game.revision;}
    assert.equal((await s.client.get('/api/admin/stats')).body.maps.played,1);
    const response=await remove(s,route.id);assert.equal(response.status,200);assert.deepEqual(await response.json(),{deleted:true,gameId:route.id});
    assert.equal(getGame(s.db,route.id),null);assert.ok(getGame(s.db,grid.id));
    assert.equal(s.db.prepare('SELECT COUNT(*) AS n FROM events WHERE game_id = ?').get(route.id).n,0);
    assert.equal(s.db.prepare("SELECT COUNT(*) AS n FROM idempotency_keys WHERE owner_id = ? AND scope IN ('action','lifecycle')").get(route.id).n,0);
    const stats=(await s.client.get('/api/admin/stats')).body;
    assert.equal(stats.games,1);assert.equal(stats.maps.played,0);assert.equal(stats.byScore[60],undefined);
    for(const name of ['export','events']){const csv=await fetch(`${s.baseUrl}/api/admin/${name}.csv`).then(r=>r.text());assert.ok(!csv.includes(route.id));assert.ok(csv.includes(grid.id));}
    const replay=await s.client.post('/api/games',body,headers);
    assert.equal(replay.status,410);assert.equal(replay.body.error.code,'GAME_DELETED');assert.ok(!JSON.stringify(replay.body).includes(route.id));
    assert.equal((await s.client.get('/api/admin/games')).body.total,1);
    assert.equal((await remove(s,route.id)).status,200,'lost deletion response can be retried safely');
    assert.deepEqual(s.db.prepare('PRAGMA foreign_key_check').all(),[]);
  }finally{await s.close();s.db.close();}
});

test('deleting an active game makes player actions inaccessible without deleting the player or session',async()=>{
  const s=await setup();try{
    const game=(await s.client.post('/api/games',{ruleset:'route-v1'},{'Idempotency-Key':'active'})).body;
    assert.equal((await remove(s,game.id)).status,200);
    assert.equal((await s.client.get('/api/games/current')).status,204);
    assert.equal((await s.client.post(`/api/games/${game.id}/actions`,{type:'abandon',actionId:'late',expectedRevision:0})).status,404);
    const next=await s.client.post('/api/games',{ruleset:'route-v1'},{'Idempotency-Key':'fresh'});
    assert.equal(next.status,201);assert.equal(next.body.attempt,2);assert.equal(next.body.playerId,game.playerId);
  }finally{await s.close();s.db.close();}
});

test('deletion rolls back events and replay changes when removing the game fails',async()=>{
  const s=await setup();try{
    const game=(await s.client.post('/api/games',{}, {'Idempotency-Key':'rollback'})).body;
    const events=s.db.prepare('SELECT COUNT(*) AS n FROM events').get().n;
    const cached=s.db.prepare('SELECT response_json FROM idempotency_keys').get().response_json;
    s.db.exec("CREATE TRIGGER prevent_delete BEFORE DELETE ON games BEGIN SELECT RAISE(ABORT,'forced failure'); END");
    assert.throws(()=>deleteGameRecord(s.db,game.id),/forced failure/);
    assert.ok(getGame(s.db,game.id));assert.equal(s.db.prepare('SELECT COUNT(*) AS n FROM events').get().n,events);
    assert.equal(s.db.prepare('SELECT response_json FROM idempotency_keys').get().response_json,cached);
  }finally{await s.close();s.db.close();}
});
