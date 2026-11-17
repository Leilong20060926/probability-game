import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('workspace switches views without remounting the game or admin frame; analysis is local', async () => {
  const previousDocument=globalThis.document;
  const previousFetch=globalThis.fetch;
  const app={hidden:false, state:'in-progress-practice'};
  const records={hidden:true};
  const threshold={value:'80'};
  const sample={value:'5'};
  const cdfResult={};
  const rockResult={};
  const analysis={hidden:true,innerHTML:'',querySelector:selector=>({
    '#cdf-threshold':threshold,'#rock-sample':sample,'#cdf-result':cdfResult,'#rock-result':rockResult,
  }[selector])};
  const frame={getAttribute:()=>frame.src};
  const buttons=['game','records','analysis'].map(view=>({dataset:{view},setAttribute(k,v){this[k]=v;}}));
  globalThis.document={
    querySelector:selector=>({'#app':app,'#records-view':records,'#analysis-view':analysis,'#records-frame':frame}[selector]),
    querySelectorAll:()=>buttons,
  };
  globalThis.fetch=()=>{throw new Error('navigation and theory must not request gameplay data');};
  try {
    await import('../frontend/src/workspace.js?test');
    assert.equal(frame.src,undefined);
    buttons[1].onclick();
    assert.equal(app.hidden,true);
    assert.equal(records.hidden,false);
    assert.equal(frame.src,'/admin.html?embedded=1');
    frame.loadedState='authorized-view';
    buttons[2].onclick();
    assert.equal(analysis.hidden,false);
    assert.match(analysis.innerHTML,/PMF/);
    assert.match(cdfResult.textContent,/0.8281/);
    threshold.value='79';threshold.oninput();
    assert.match(cdfResult.textContent,/0.6082/);
    assert.match(rockResult.textContent,/P\(R=0\)/);
    buttons[0].onclick();
    assert.equal(app.hidden,false);
    assert.equal(app.state,'in-progress-practice');
    buttons[1].onclick();
    assert.equal(frame.loadedState,'authorized-view');
  } finally {
    globalThis.document=previousDocument;
    globalThis.fetch=previousFetch;
  }
});

test('route workspace preserves game and record frame; exact analysis mounts once without player API calls',async()=>{
  const previousDocument=globalThis.document,previousFetch=globalThis.fetch;
  const data=JSON.parse(await readFile(new URL('../frontend/data/route-analysis.json',import.meta.url),'utf8'));
  const app={hidden:false,state:'live-route-trial'},records={hidden:true},input={value:'80'},result={};
  const analysis={hidden:true,innerHTML:'',querySelector:selector=>selector==='#route-cdf-threshold'?input:result};
  const frame={getAttribute:()=>frame.src},buttons=['game','records','analysis'].map(view=>({dataset:{view},setAttribute(k,v){this[k]=v;}})),calls=[];
  globalThis.document={querySelector:selector=>({'#app':app,'#records-view':records,'#analysis-view':analysis,'#records-frame':frame}[selector]),querySelectorAll:()=>buttons};
  globalThis.fetch=async path=>{calls.push(path);assert.ok(['/data/route-analysis.json','/api/route/analysis'].includes(path));return Response.json(path.startsWith('/data/')?data:data.scenarios[0]);};
  const settle=async()=>{for(let i=0;i<5;i++)await new Promise(resolve=>setImmediate(resolve));};
  try{
    await import('../frontend/src/route-workspace.js?test');
    buttons[1].onclick();assert.equal(frame.src,'/admin.html?embedded=1');frame.loadedState='filtered-records';
    buttons[2].onclick();await settle();assert.match(analysis.innerHTML,/exact_dp/);
    buttons[0].onclick();assert.equal(app.hidden,false);assert.equal(app.state,'live-route-trial');
    buttons[1].onclick();assert.equal(frame.loadedState,'filtered-records');
    buttons[2].onclick();await settle();assert.equal(calls.length,2);
    assert.equal(buttons[2]['aria-pressed'],'true');assert.equal(buttons[0]['aria-pressed'],'false');
  }finally{globalThis.document=previousDocument;globalThis.fetch=previousFetch;}
});
