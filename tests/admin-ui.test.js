// Minimal DOM harness: verifies the public records flow, not browser rendering.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('public records UI loads, filters, paginates, retries and downloads without login calls', async () => {
  const originals=Object.fromEntries(['document','location','fetch','FormData','setTimeout','confirm'].map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));
  const nodes=new Map();
  const node=id=>{
    if(!nodes.has(id)) nodes.set(id,{innerHTML:'',textContent:'',disabled:false,
      replaceChildren(){this.innerHTML='';}});
    return nodes.get(id);
  };
  const exports=['export','events'].map(name=>({dataset:{export:name}}));
  const downloaded=[];
  const calls=[];
  let fail=false;
  let deletions=[],approved=false,deleted=false,loseDelete=true;
  globalThis.confirm=()=>approved;
  globalThis.document={
    querySelector:node,
    querySelectorAll:selector=>{
      if(selector==='[data-export]')return exports;
      if(selector==='[data-delete-game]'){deletions=[...node('#games').innerHTML.matchAll(/data-delete-game="([^"]+)"/g)].map(([,id])=>({dataset:{deleteGame:id}}));return deletions;}
      return [...nodes.values(),...exports,...deletions];
    },
    createElement:()=>{const link={click(){downloaded.push(this.download);}};return link;},
  };
  globalThis.location={search:''};
  globalThis.FormData=class {constructor(form){this.entries=form.entries;}[Symbol.iterator](){return this.entries[Symbol.iterator]();}};
  globalThis.setTimeout=fn=>{queueMicrotask(fn);return 0;};
  globalThis.fetch=async (path,options)=>{
    calls.push({path,method:options.method});
    if(fail) return Response.json({error:{code:'UNAVAILABLE',message:'暫時無法讀取'}},{status:503});
    const url=new URL(path,'https://test.example');
    if(options.method==='DELETE'){
      assert.equal(url.pathname,'/api/admin/games/game-1');deleted=true;
      if(loseDelete){loseDelete=false;throw new TypeError('lost deletion response');}
      return Response.json({deleted:true,gameId:'game-1'});
    }
    if(url.pathname.endsWith('.csv')) return new Response('gameId\r\ntest-game\r\n',{headers:{'Content-Type':'text/csv'}});
    if(url.pathname==='/api/admin/stats') return Response.json({games:deleted?50:51,players:2,finished:1,goldFinishRate:0,avgScore:0,avgDurationMs:1000,byReason:{abandoned:1},byScore:{0:1}});
    assert.equal(url.pathname,'/api/admin/games');
    return Response.json({total:deleted?50:51,page:Number(url.searchParams.get('page')),pageSize:50,games:[{id:deleted?'game-2':'game-1',playerId:'player-1',attempt:1,status:'finished',reason:'abandoned',score:0,turns:1,durationMs:1000}]});
  };
  const settle=async()=>{for(let i=0;i<5;i++)await new Promise(resolve=>setImmediate(resolve));};
  const refresh=()=>node('#filters').onsubmit({preventDefault(){},currentTarget:{entries:[['ruleset','grid'],['version','0.2.0'],['status','finished'],['source','human'],['configId','config-test'],['mode','server']]}});
  try {
    const html=await readFile(new URL('../frontend/admin.html',import.meta.url),'utf8');
    assert.doesNotMatch(html,/id="login"|type="password"|id="logout"|id="authorized"/);
    assert.doesNotMatch(html,/name="(?:ruleset|version|status|source)"|id="formal"/);
    await import('../frontend/src/admin.js?public-ui');
    await settle();
    assert.equal(calls.length,2);
    assert.match(node('#stats').innerHTML,/局數 51/);
    assert.match(node('#games').innerHTML,/game-1/);
    assert.equal(node('#next').disabled,false);
    node('#next').onclick();await settle();
    assert.match(node('#page-info').textContent,/第 2 頁/);
    assert.equal(node('#next').disabled,true);
    const beforeCancel=calls.length;deletions[0].onclick();assert.equal(calls.length,beforeCancel);
    approved=true;await deletions[0].onclick();
    assert.match(node('#status').textContent,/刪除結果尚未確認/);assert.match(node('#games').innerHTML,/game-1/);
    await deletions[0].onclick();
    assert.match(node('#status').textContent,/已刪除此局/);assert.match(node('#games').innerHTML,/game-2/);
    assert.match(node('#page-info').textContent,/第 1 頁，共 50 局/);
    refresh();await settle();
    const filtered=new URL(calls.at(-1).path,'https://test.example').searchParams;
    for(const removed of ['ruleset','version','status','source'])assert.equal(filtered.has(removed),false);
    assert.equal(filtered.get('configId'),'config-test');
    assert.match(node('#page-info').textContent,/第 1 頁/);
    assert.doesNotMatch(node('#stats').innerHTML,/請按「只看正式/);
    for(const button of exports) await button.onclick();
    assert.deepEqual(downloaded,['games.csv','events.csv']);
    const exported=calls.filter(call=>call.path.includes('.csv?'));
    for(const call of exported){const query=new URL(call.path,'https://test.example').searchParams;assert.equal(query.has('ruleset'),false);assert.equal(query.get('configId'),'config-test');}
    fail=true;refresh();await settle();
    assert.equal(node('#games').innerHTML,'');
    assert.equal(node('#page-info').textContent,'');
    assert.match(node('#status').textContent,/暫時無法讀取/);
    fail=false;refresh();await settle();
    assert.match(node('#games').innerHTML,/game-2/);
    assert.equal(calls.filter(call=>call.method==='DELETE').length,2);
    assert.ok(calls.every(call=>!call.path.includes('/login') && !call.path.includes('/logout')));
  } finally {
    for(const [key,descriptor] of Object.entries(originals)) {
      if(descriptor) Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];
    }
  }
});
