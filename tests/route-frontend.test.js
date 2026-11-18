import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {mountRouteApp} from '../frontend/src/route-app.js';
import {createRouteTrial} from '../frontend/src/route-trial.js';
import {routeCreateRequest,routeActionRequest} from '../frontend/src/route-storage.js';
import {playRouteEffects} from '../frontend/src/route-effects.js';
import {mountRouteAnalysis,validateExact} from '../frontend/src/route-analysis-view.js';
import {formalFilters,recordsStatsMarkup} from '../frontend/src/route-records.js';
import {api} from '../frontend/src/storage.js';
import {startTestServer} from '../backend/tests/helpers.js';
import {getGame,saveGame,insertEvents} from '../backend/src/games-repo.js';
import {newRouteGame} from '../shared/route-engine.js';
import {makeConfig} from '../shared/route-config.js';
import {Rational} from '../shared/rational.js';
import {Worker as ThreadWorker} from 'node:worker_threads';
import {createLocalAdvisor} from '../frontend/src/route-advisor.js';
import {createFrontendServer} from '../scripts/dev.mjs';

// Event wiring/transport checks; this harness cannot verify browser layout.
function root() {
  let html='',nodes=[];
  return {
    hidden:false,
    set innerHTML(value){html=value;nodes=[...value.matchAll(/<button\b([^>]*)>/g)].map(([,attrs])=>({
      dataset:Object.fromEntries([...attrs.matchAll(/data-([\w-]+)="([^"]*)"/g)].map(([,k,v])=>[k,v])),
      disabled:/\bdisabled\b/.test(attrs),focus(){},
    }));},
    get innerHTML(){return html;},
    querySelectorAll(selector){const m=selector.match(/^\[data-([\w-]+)(?:="([^"]*)")?\]$/);return m?nodes.filter(n=>m[1] in n.dataset && (m[2]===undefined||n.dataset[m[1]]===m[2])):[];},
    querySelector(selector){return this.querySelectorAll(selector)[0]||null;},
  };
}
const mount=(element,options={})=>{const ui=mountRouteApp(element,{interval:()=>{},clock:()=>0,reducedMotion:()=>true,confirm:()=>true,...options});ui.setNickname('測試玩家');return ui;};
const deck=prefix=>{const counts={H:4,V:4,B:2,X:1,R:5};for(const t of prefix)assert.ok(--counts[t]>=0);return [...prefix,...'HVBXR'.split('').flatMap(t=>Array(counts[t]).fill(t))];};
const script=()=>({mapIds:[1,1,1],goldMapIndex:3,decks:Array.from({length:3},()=>deck('HHHVVXBHV'))});
const steps=[{type:'pave',pay:{H:2,V:0,B:0,X:0}},{type:'choose_branch',branch:'B'},{type:'pave',pay:{H:1,V:0,B:0,X:1}},{type:'pave',pay:{H:1,V:1,B:0,X:0}}];
async function clickStep(ui,step){if(step.pay){for(const [t,n] of Object.entries(step.pay))for(let i=0;i<n;i++)ui.select(t);return ui.handle(step.type);}return ui.handle('branch-'+step.branch);}
const settle=async()=>{for(let i=0;i<6;i++)await new Promise(resolve=>setImmediate(resolve));};
const bundle=()=>readFile(new URL('../frontend/data/route-analysis.json',import.meta.url),'utf8').then(JSON.parse);

test('route trial: mode required, memory only, three maps and legal payment buttons',async()=>{
  let calls=0,now=1000000;
  const element=root(),ui=mount(element,{server:()=>{calls++;throw Error('practice must not contact server');},trialFactory:()=>createRouteTrial({now:()=>now,gameOptions:{script:script()}})});
  assert.equal(calls,0);assert.equal(element.querySelector('[data-action="start"]').disabled,true);
  await ui.chooseMode('trial');await ui.start();
  assert.equal(ui.state.game.playerNickname,'測試玩家');
  assert.equal(ui.state.game.ruleset,'route-v1');
  assert.equal(ui.state.game.mapId,1);assert.equal(ui.state.game.mapIndex,1);
  ui.select('H');assert.equal(element.querySelector('[data-action="pave"]').disabled,true);
  ui.select('H');assert.equal(element.querySelector('[data-action="pave"]').disabled,false);
  await ui.handle('pave');assert.equal(ui.state.game.phase,'fork');
  assert.equal(element.querySelector('[data-action="pave"]'),null);
  assert.equal(element.querySelector('[data-action="branch-A"]').disabled,false);
  await ui.handle('branch-B');assert.equal(ui.state.game.turn,1);
  await clickStep(ui,steps[2]);await clickStep(ui,steps[3]);
  assert.equal(ui.state.game.coins,1);assert.equal(ui.state.game.mapIndex,2);
  ui.changeMode();assert.equal(ui.state.mode,'trial','cannot switch collection policy while playing');
  for(let m=2;m<=3;m++)for(const step of steps)await clickStep(ui,step);
  assert.equal(ui.state.game.score,100);assert.equal(ui.state.game.turn,9);
  assert.match(element.innerHTML,/本局未記錄/);assert.equal(calls,0);
  await ui.nextPlayer();assert.equal(ui.state.game,null);assert.equal(calls,0);
  assert.equal(ui.state.nickname,'');assert.equal(element.querySelector('[data-action="start"]').disabled,true);
});

test('nickname is required before start, escaped in the input and locked during play; reload restores it without opening the old result',async()=>{
  const element=root(),trial=createRouteTrial({gameOptions:{script:script()}});
  const ui=mount(element,{server:trial});
  ui.setNickname('');await ui.chooseMode('server');await ui.start();assert.equal(ui.state.game,null);
  ui.setNickname('x'.repeat(21));assert.equal(element.querySelector('[data-action="start"]').disabled,true);
  ui.setNickname('  <礦工>  ');assert.match(element.innerHTML,/&lt;礦工&gt;/);
  await ui.start();assert.equal(ui.state.game.playerNickname,'<礦工>');
  ui.setNickname('冒名');assert.equal(ui.state.nickname,'<礦工>');
  const restored=mount(root(),{server:trial});await restored.chooseMode('server');
  assert.equal(restored.state.nickname,'<礦工>');assert.equal(restored.state.game.id,ui.state.game.id);
  await restored.handle('end');
  const reloaded=mountRouteApp(root(),{server:trial,interval:()=>{},clock:()=>0,reducedMotion:()=>true});
  await reloaded.chooseMode('server');assert.equal(reloaded.state.nickname,'<礦工>');assert.equal(reloaded.state.game,null);
  await reloaded.start();assert.equal(reloaded.state.game.playerNickname,'<礦工>');
});

test('route memory adapter: replay, invalid pay and strict 300-second boundary',async()=>{
  let now=1000000;
  const trial=createRouteTrial({now:()=>now,gameOptions:{script:script()}});
  const create=routeCreateRequest('touch'),game=await trial(create.path,create.options);
  assert.deepEqual(await trial(create.path,create.options),game);
  const invalid=routeActionRequest(game,{type:'pave',pay:{H:1}});
  await assert.rejects(trial(invalid.path,invalid.options),e=>e.status===422);
  assert.deepEqual(await trial('/api/games/current'),game);
  const action=routeActionRequest(game,steps[0]),confirmed=await trial(action.path,action.options);
  now=game.deadlineAt;
  assert.deepEqual(await trial(action.path,action.options),confirmed,'confirmed action replay remains valid after deadline');
  const expired=await trial('/api/games/current');
  assert.equal(expired.reason,'timeout');assert.equal(expired.turn,1);assert.equal(expired.score,0);
  assert.ok(!('goldMapIndex' in expired)&&!('deck' in expired)&&!('script' in expired));
});

test('route effects: all effects preserve order, consecutive rocks get their own display',async()=>{
  const effects=[{type:'pay'},{type:'advance'},{type:'rock',a:1},{type:'rock',a:2},{type:'draw'},{type:'fork_ready'}],shown=[],waits=[];
  await playRouteEffects(effects,e=>shown.push(e),async ms=>waits.push(ms));
  assert.deepEqual(shown,[...effects,null]);assert.deepEqual(waits,[60,60,1000,1000,60,60]);
});

test('route hint Worker protocol: compute off-thread, preserve revision and cancel pending advice',async()=>{
  class BrowserWorker {
    constructor(url){
      const source=`import {parentPort} from 'node:worker_threads'; globalThis.self={postMessage:data=>parentPort.postMessage(data)}; await import(${JSON.stringify(url.href)}); parentPort.on('message',data=>self.onmessage({data}));`;
      this.thread=new ThreadWorker(new URL('data:text/javascript,'+encodeURIComponent(source)));
      this.thread.on('message',data=>this.onmessage?.({data}));this.thread.on('error',error=>this.onerror?.(error));
    }
    postMessage(data){this.thread.postMessage(data);}
    terminate(){this.thread.terminate();}
  }
  const trial=createRouteTrial({gameOptions:{script:script()}}),req=routeCreateRequest('pointer'),game=await trial(req.path,req.options);
  const advisor=createLocalAdvisor(BrowserWorker);
  try {
    const answer=await advisor.query(game);
    assert.equal(answer.gameId,game.id);assert.equal(answer.revision,game.revision);assert.equal(answer.source,'exact_dp');
    assert.equal(answer.options.filter(row=>row.best).length,1);
    assert.ok(answer.options.some(row=>row.action.type==='pave'&&row.action.pay.H===2));
    const pending=advisor.query(game);advisor.dispose();await assert.rejects(pending,/已取消/);
    await assert.rejects(createLocalAdvisor(null).query(game),/不支援/);
  }finally{advisor.dispose();}
});

test('failed server initialization permits choosing memory trial, and never silently changes mode',async()=>{
  const element=root(),ui=mount(element,{server:async()=>{throw new TypeError('offline');}});
  await ui.chooseMode('server');assert.equal(ui.state.mode,'server');assert.equal(ui.state.pending,'initialize');
  assert.equal(element.querySelector('[data-action="start"]').disabled,true);
  assert.equal(element.querySelector('[data-action="mode"]').disabled,false);
  ui.changeMode();await ui.chooseMode('trial');await ui.start();assert.equal(ui.state.mode,'trial');
  assert.equal(ui.state.game.ruleset,'route-v1');
});

async function httpFixture(operation) {
  const server=await startTestServer(),original=globalThis.fetch,cookies=new Map(),requests=[];
  let hook=async()=>{};
  globalThis.fetch=async(path,options={})=>{
    const response=await original(server.baseUrl+path,{...options,headers:{...options.headers,Cookie:[...cookies].map(([k,v])=>`${k}=${v}`).join('; ')}});
    for(const cookie of response.headers.getSetCookie()){const [k,v]=cookie.split(';')[0].split('=');cookies.set(k,v);}
    requests.push({path,options:structuredClone(options)});await hook(path,options,response);return response;
  };
  try{await operation({...server,requests,setHook:fn=>hook=fn,clearCookies:()=>cookies.clear()});}
  finally{globalThis.fetch=original;await server.close();server.db.close();}
}
function installFixture(db,id){
  const old=getGame(db,id),game=newRouteGame({id,playerId:old.playerId,attempt:old.attempt,now:old.startedAt,config:makeConfig(),script:script()});
  game.mode='server';game.revision=old.revision;
  db.prepare('DELETE FROM events WHERE game_id = ?').run(id);insertEvents(db,id,game.events,0);saveGame(db,game,old.startedAt);
}

test('route UI over real HTTP: lost create/action, exact retry, three maps, public stats and CSV',async()=>httpFixture(async({db,requests,setHook,clearCookies})=>{
  let loseCreate=true,loseAction=false;
  setHook(async(path,options,response)=>{
    if(path==='/api/games'&&loseCreate){loseCreate=false;const view=await response.clone().json();installFixture(db,view.id);throw new TypeError('lost create response');}
    if(path.endsWith('/actions')&&loseAction){loseAction=false;throw new TypeError('lost action response');}
  });
  const element=root(),ui=mount(element,{server:api});
  assert.equal(requests.length,0);
  await ui.chooseMode('server');await ui.start();
  assert.equal(ui.state.pending,'action');assert.equal(ui.state.game,null);
  assert.match(element.innerHTML,/操作結果尚未確認/);assert.equal(element.querySelector('[data-action="start"]').disabled,true);
  await ui.retry();assert.equal(ui.state.game.mapId,1);
  const creates=requests.filter(r=>r.path==='/api/games');
  assert.equal(creates.length,2);assert.equal(creates[0].options.headers['Idempotency-Key'],creates[1].options.headers['Idempotency-Key']);
  assert.equal(JSON.parse(creates[0].options.body).ruleset,'route-v1');
  assert.equal(JSON.parse(creates[0].options.body).nickname,'測試玩家');
  for(const step of steps.slice(0,3))await clickStep(ui,step);
  loseAction=true;await clickStep(ui,steps[3]);
  const count=db.prepare('SELECT COUNT(*) AS n FROM events').get().n;
  assert.equal(ui.state.game.mapIndex,1);assert.equal(ui.state.pending,'action');
  await ui.retry();assert.equal(ui.state.game.mapIndex,2);assert.equal(ui.state.game.coins,1);
  const actions=requests.filter(r=>r.path.endsWith('/actions'));
  assert.equal(actions.at(-1).options.body,actions.at(-2).options.body);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM events').get().n,count,'retry cannot duplicate events or redraw a map');
  for(let map=2;map<=3;map++)for(const step of steps)await clickStep(ui,step);
  assert.equal(ui.state.game.score,100);assert.equal(ui.state.game.revision,12);
  clearCookies();
  const filters=new URLSearchParams(formalFilters),stats=await api('/api/admin/stats?'+filters);
  assert.equal(stats.games,1);assert.equal(stats.maps.played,3);assert.equal(stats.maps.passed,3);
  for(const name of ['export','events'])assert.match(await(await api(`/api/admin/${name}.csv?${filters}`,{raw:true})).text(),/route-v1/);
}));

test('route migration UI: old grid must be explicitly ended before new route; conflict refreshes authority',async()=>httpFixture(async({db})=>{
  await api('/api/players',{body:{}});
  const old=await api('/api/games',{body:{},headers:{'Idempotency-Key':'legacy-fixture'}});
  let confirmed=false;
  const element=root(),ui=mount(element,{server:api,confirm:()=>confirmed});
  await ui.chooseMode('server');assert.equal(ui.state.game.id,old.id);
  assert.match(element.innerHTML,/結束舊局，準備三地圖/);
  await ui.start();await ui.handle('end-grid');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM games').get().n,1);
  assert.equal(getGame(db,old.id).status,'playing');
  confirmed=true;await ui.handle('end-grid');
  assert.equal(getGame(db,old.id).reason,'abandoned');assert.equal(getGame(db,old.id).score,0);
  await ui.start();const route=ui.state.game;assert.equal(route.ruleset,'route-v1');
  await api(`/api/games/${route.id}/lifecycle`,{body:{type:'hidden',eventId:'other-tab'}});
  await ui.submit({type:'abandon'});
  assert.equal(ui.state.pending,undefined);assert.equal(ui.state.game.status,'playing');
  assert.match(ui.state.notice,/其他操作更新/);
  await ui.handle('end');assert.equal(ui.state.game.reason,'abandoned');
}));

test('route hints: lifecycle is recorded once, stale response cannot overwrite a newer game revision',async()=>httpFixture(async({db,requests,setHook})=>{
  const ui=mount(root(),{server:api});await ui.chooseMode('server');await ui.start();
  installFixture(db,ui.state.game.id);
  // Restore the controller from authoritative state with a revision conflict.
  await api(`/api/games/${ui.state.game.id}/lifecycle`,{body:{type:'visible',eventId:'fixture-sync'}});
  await ui.submit({type:'abandon'});assert.equal(ui.state.game.status,'playing');
  let release;
  setHook(async path=>{if(path.endsWith('/hints'))await new Promise(resolve=>release=resolve);});
  await ui.openHints();await settle();assert.equal(ui.state.hintLoading,true);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM events WHERE type='hint_shown'").get().n,1);
  const hintsCall=requests.find(r=>r.path.endsWith('/hints'));
  assert.ok(hintsCall);const before=ui.state.game.revision;
  await clickStep(ui,steps[0]);assert.equal(ui.state.game.phase,'fork');assert.ok(ui.state.game.revision>before);
  release();await settle();assert.equal(ui.state.hints,null);assert.equal(ui.state.hintLoading,false);
  setHook(async()=>{});await ui.openHints();await settle();
  assert.equal(ui.state.hints.revision,ui.state.game.revision);
  assert.deepEqual(ui.state.hints.options.map(row=>row.action.branch),['A','B']);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM events WHERE type='hint_shown'").get().n,1,'refreshing open panel must not record another opening');
}));

test('exact analysis artifact: PMF, CDF, expectation and variance remain rational and version matched',async()=>{
  const {scenarios}=await bundle(),base=validateExact(scenarios.find(row=>row.scenario==='base'));
  assert.equal(scenarios.length,8);assert.equal(base.config.maxRockCost,3);assert.equal(base.tieOrder,'mergedByPay');assert.equal(base.source,'exact_dp');
  const q=value=>new Rational(value.numerator,value.denominator);
  const mean=base.pmf.reduce((sum,row)=>sum.add(q(row.prob).mul(row.score)),new Rational(0));
  const second=base.pmf.reduce((sum,row)=>sum.add(q(row.prob).mul(row.score**2)),new Rational(0));
  assert.ok(mean.eq(q(base.E)));assert.ok(second.eq(q(base.E2)));assert.ok(second.sub(mean.mul(mean)).eq(q(base.Var)));
  let cumulative=new Rational(0);for(const [i,row] of base.pmf.entries()){cumulative=cumulative.add(q(row.prob));assert.ok(cumulative.eq(q(base.cdf[i].prob)));}
  assert.throws(()=>validateExact({...base,configId:'outdated'}),/配置不符/);
  const stats={games:2,players:1,finished:1,goldFinishRate:0,byReason:{abandoned:1},byScore:{0:1},maps:{played:3,passed:2,passRate:2/3,byMapId:{1:{played:3,passed:2}}}};
  assert.match(recordsStatsMarkup(stats,new URLSearchParams(formalFilters),base),/已結束地圖 3 張/);
  assert.doesNotMatch(recordsStatsMarkup(stats,new URLSearchParams({ruleset:'grid'}),base),/來源 exact_dp/);
  assert.doesNotMatch(recordsStatsMarkup(stats,new URLSearchParams({...formalFilters,reason:'gold'}),base),/來源 exact_dp/);
});

test('analysis UI: static fallback, API-only availability, exact CDF thresholds and explicit invalid-version error',async()=>{
  const data=await bundle(),base=data.scenarios[0];
  const nodes=new Map(),element={innerHTML:'',querySelector(selector){if(!nodes.has(selector))nodes.set(selector,{value:'80'});return nodes.get(selector);}};
  await mountRouteAnalysis(element,{fetcher:async path=>path.startsWith('/data/')?Response.json(data):new Response('',{status:404})});
  assert.match(element.innerHTML,/exact_dp/);assert.match(element.innerHTML,/HV→HV（比較用）/);
  const input=nodes.get('#route-cdf-threshold');input.value='-1';input.oninput();assert.match(nodes.get('#route-cdf-result').textContent,/= 0/);
  input.value='60';input.oninput();assert.match(nodes.get('#route-cdf-result').textContent,new RegExp(base.cdf[1].prob.numerator));
  input.value='100';input.oninput();assert.match(nodes.get('#route-cdf-result').textContent,/= 1/);
  await mountRouteAnalysis(element,{fetcher:async path=>path.startsWith('/api/')?Response.json(base):new Response('',{status:404})});
  assert.match(element.innerHTML,/期望得分/);
  await mountRouteAnalysis(element,{fetcher:async path=>Response.json(path.startsWith('/api/')?{...base,configId:'wrong'}:data)});
  assert.match(element.innerHTML,/配置不符/);assert.doesNotMatch(element.innerHTML,/class="probability-chart"/);
});

test('development and backend HTTP serve the new module graphs, Worker and shared whitelist',async()=>{
  const dev=createFrontendServer(),backend=await startTestServer();
  await new Promise(resolve=>dev.listen(0,'127.0.0.1',resolve));
  try{
    for(const base of [`http://127.0.0.1:${dev.address().port}`,backend.baseUrl]) {
      const queue=['/src/route-main.js','/src/route-workspace.js','/src/admin.js','/src/route-hints-worker.js'],seen=new Set();
      while(queue.length){
        const pathname=queue.shift();if(seen.has(pathname))continue;seen.add(pathname);
        const response=await fetch(base+pathname);assert.equal(response.status,200,pathname);assert.match(response.headers.get('content-type'),/javascript/);
        const source=await response.text();
        for(const [,specifier] of source.matchAll(/\bimport\s+(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]/g))queue.push(new URL(specifier,base+pathname).pathname);
      }
      assert.ok(seen.has('/shared/route-engine.js'));assert.ok(seen.has('/shared/rational.js'));
      for(const path of ['/','/admin.html','/src/route.css','/data/route-analysis.json','/assets/cards/horizontal.png','/assets/targets/golden.png'])assert.equal((await fetch(base+path)).status,200,path);
      for(const path of ['/shared/nope.js','/shared/.env','/shared/backend/src/server.js'])assert.equal((await fetch(base+path)).status,404,path);
    }
  }finally{await new Promise(resolve=>dev.close(resolve));await backend.close();backend.db.close();}
});
