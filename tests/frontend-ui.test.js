// Minimal DOM harness for application event wiring; not a browser/layout test.
import {test} from 'node:test';
import assert from 'node:assert/strict';

test('player UI blocks uncertain mutations, retries same create key, and recovers conflict/timeout', async () => {
  const originals = Object.fromEntries(['document','fetch','setInterval','setTimeout','matchMedia','confirm'].map(k => [k, globalThis[k]]));
  let nodes = [];
  let html = '';
  const dialog = {focus(){},classList:{contains:()=>true}};
  const app = {
    set innerHTML(value) {
      html = value;
      nodes = [...value.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)].map(([,attrs]) => {
        const dataset = Object.fromEntries([...attrs.matchAll(/data-([\w-]+)="([^"]*)"/g)].map(([,k,v]) => [k,v]));
        return {dataset, disabled:/\bdisabled\b/.test(attrs), focus(){}, classList:{contains:()=>false}};
      });
    },
    get innerHTML(){return html;},
    querySelectorAll(selector) {
      if (selector.includes('.dialog button')) return nodes.filter(n => !n.disabled);
      return nodes.filter(node => selector.split(', ').some(part => {
        const match = part.match(/^\[data-([\w-]+)(?:="([^"]*)")?\]$/);
        return match && match[1] in node.dataset && (match[2] === undefined || node.dataset[match[1]] === match[2]);
      }));
    },
    querySelector(selector) {
      if (selector === '.dialog') return html.includes('role="dialog"') ? dialog : null;
      return this.querySelectorAll(selector)[0] || null;
    },
  };
  let timer;
  globalThis.document = {querySelector:()=>app, addEventListener(){},activeElement:dialog};
  globalThis.setInterval = fn => {timer = fn;};
  globalThis.setTimeout = fn => {queueMicrotask(fn);return 0;};
  globalThis.matchMedia = () => ({matches:false});
  globalThis.confirm = () => true;
  let game = null;
  let createCalls = [];
  let conflict = false;
  let actionCalls = 0;
  const requests = [];
  globalThis.fetch = async (path, options) => {
    const body = options.body && JSON.parse(options.body);
    requests.push({path,body});
    if (path === '/api/players') return Response.json({playerId:'player-test',nextAttempt:1});
    if (path === '/api/games/current') return game ? Response.json(game) : new Response(null,{status:204});
    if (path === '/api/games') {
      createCalls.push(options.headers['Idempotency-Key']);
      game ||= {id:'test-game',playerId:'player-test',attempt:1,revision:0,mode:'server',status:'playing',
        startedAt:Date.now(),serverNow:Date.now(),deadlineAt:Date.now()+300000,endedAt:null,
        hand:['horizontal','vertical'],board:[],targets:[0,2,4].map(row=>({row,revealed:false})),deckRemaining:17,coins:0,turn:0,score:0};
      if (createCalls.length === 1) throw new TypeError('response lost');
      return Response.json(game,{status:201});
    }
    if (path.endsWith('/actions')) {
      actionCalls++;
      if (actionCalls === 2) {
        game = {...game,revision:4,turn:4,coins:0,deckRemaining:15,
          hand:['vertical','vertical']};
        return Response.json({game,effects:[
          {type:'place',position:[2,4],cardId:'horizontal'},
          {type:'reveal',row:2,reward:'coin'},
          {type:'rock',removed:'2,4'},
          {type:'draw',cardId:'vertical'},
          {type:'unreveal',row:2},
        ]});
      }
      conflict = true;
      game = {...game,revision:3,turn:3,board:[1,2,3].map(col=>({row:2,col,cardId:'horizontal'}))};
      return Response.json({error:{code:'REVISION_CONFLICT',message:'conflict'},game},{status:409});
    }
    throw new Error('Unexpected path ' + path);
  };
  const settle = async () => {for(let i=0;i<8;i++) await new Promise(resolve=>setImmediate(resolve));};
  const button = action => nodes.find(n => n.dataset.action === action);
  try {
    await import('../frontend/src/app.js?ui-test');
    await settle();
    assert.equal(requests.length,0, 'opening the page must not create a server player or game');
    assert.equal(button('start').disabled,true);
    button('choose-trial').onclick();
    await settle();
    assert.match(html,/不記錄試玩/);
    button('start').onclick();
    await settle();
    nodes.find(n=>n.dataset.hand==='0').onclick();
    button('discard').onclick();
    await settle();
    assert.equal(button('change-mode').disabled,true, 'cannot change collection policy mid-game');
    button('end').onclick();
    await settle();
    assert.match(html,/本局未儲存、未上傳/);
    assert.equal(requests.length,0, 'practice actions and results must never call backend APIs');
    button('change-mode').onclick();
    button('choose-server').onclick();
    await settle();
    assert.equal(button('start').disabled, false);
    button('start').onclick();
    assert.equal(button('start').disabled, true);
    await settle();
    assert.match(html, /操作結果尚未確認/);
    assert.equal(button('start').disabled, true);
    button('retry').onclick();
    await settle();
    assert.equal(createCalls.length,2);
    assert.equal(createCalls[0],createCalls[1]);
    assert.equal(button('end').disabled,false);
    assert.doesNotMatch(html,/尚未連接雲端|僅存於此瀏覽器/);
    nodes.find(n=>n.dataset.hand==='0').onclick();
    assert.ok(nodes.some(n=>n.dataset.cell==='2,1' && !n.disabled));
    button('discard').onclick();
    await settle();
    assert.equal(conflict,true);
    assert.match(html,/已同步最新狀態/);
    assert.equal(button('discard').disabled,true);
    assert.equal(requests.filter(r=>r.path.endsWith('/actions')).length,1);
    nodes.find(n=>n.dataset.hand==='0').onclick();
    const endpointRoad=nodes.find(n=>n.dataset.cell==='2,4');
    assert.equal(endpointRoad.disabled,false);
    endpointRoad.onclick();
    await settle();
    assert.match(html,/落石撤銷本回合翻牌/);
    assert.match(html,/第 3 列終點恢復未翻開，金幣已扣回/);
    assert.match(html,/已得金幣[\s\S]*?<strong>\s*0<small>/);
    assert.match(html,/第 3 列第 6 欄：未知終點/);
    assert.equal(button('end').disabled,false);
    // Synchronize a finished timeout through the current-state path.
    game = {...game,status:'finished',reason:'timeout',endedAt:game.deadlineAt,serverNow:game.deadlineAt};
    // Existing UI clock reaches zero, then polls the server for authoritative finish.
    const realNow = performance.now.bind(performance);
    const oldPerformance = globalThis.performance;
    globalThis.performance = {now:()=>realNow()+400000};
    try { timer(); await settle(); } finally {globalThis.performance = oldPerformance;}
    assert.match(html,/探勘時間結束/);
    assert.equal(button('start').disabled,false);
    assert.equal(button('next-player').disabled,false);
  } finally {
    for (const [key,value] of Object.entries(originals)) {
      if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
    }
  }
});
