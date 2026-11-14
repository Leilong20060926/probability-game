import {test} from 'node:test';
import assert from 'node:assert/strict';

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
