import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fittedSize,mountViewportFit} from '../frontend/src/route-fit.js';

test('game fitting keeps the entire canvas inside desktop, portrait, landscape and short windows',()=>{
  for(const [width,height] of [[1440,680],[1280,540],[900,420],[390,690],[360,500],[320,420]]) {
    const mobile=width<=620,fit=fittedSize(width,height,mobile?360:900,mobile?780:640);
    assert.ok(fit.scale>0&&fit.scale<=1);
    assert.ok(fit.width*fit.scale<=width+.001);
    assert.ok(fit.height*fit.scale<=height+.001);
    assert.ok(fit.height+.001>=(mobile?780:640));
  }
});

test('viewport fitter measures tall controls, refits after resize/repaint and ignores hidden views',()=>{
  let observer,disconnected=false,resizeListener;
  const status={scrollHeight:860,get clientHeight(){return parseFloat(game.style.height)-66;}};
  const layout={get scrollHeight(){return parseFloat(game.style.height)-46;}};
  let game={style:{},querySelector:selector=>selector==='.route-layout'?layout:selector==='.route-header'?{offsetHeight:46}:status};
  const frame={clientWidth:1200,clientHeight:590,querySelector:()=>game};
  const fitter=mountViewportFit(frame,{
    ResizeObserverClass:class {constructor(callback){observer=callback;}observe(target){assert.equal(target,frame);}disconnect(){disconnected=true;}},
    events:{addEventListener(type,fn){assert.equal(type,'resize');resizeListener=fn;},removeEventListener(type,fn){assert.equal(fn,resizeListener);}},
  });
  const fits=()=>{
    const scale=Number(game.style.transform.match(/scale\(([^)]+)\)/)[1]);
    assert.ok(parseFloat(game.style.height)>=926,'the bottom controls must fit the virtual canvas');
    assert.ok(parseFloat(game.style.height)*scale<=frame.clientHeight+.001);
    assert.ok(parseFloat(game.style.width)*scale<=frame.clientWidth+.001);
  };
  fitter.update();fits();
  frame.clientWidth=390;frame.clientHeight=650;observer();fits();
  const replacement={...game,style:{}};game=replacement;fitter.update();fits();
  const before={...game.style};frame.clientHeight=0;resizeListener();assert.deepEqual(game.style,before);
  fitter.dispose();assert.equal(disconnected,true);
});
