import {test} from 'node:test';
import assert from 'node:assert/strict';
import {rockFrames,playRockEffects,actionNotice} from '../frontend/src/effects.js';
import {newGame,act} from '../frontend/src/engine.js';
import {baseline,scores,distribution,scenarios,firstRockProbability,rockCountProbability} from '../frontend/src/analysis.js';

test('confirmed rock sequence shows newly placed road before removing it, then processes consecutive rocks', async () => {
  const before=[{row:2,col:1,cardId:'horizontal'}];
  const effects=[{type:'place',position:[2,2],cardId:'horizontal'},
    {type:'rock',removed:'2,2'},{type:'rock',removed:'2,1'},{type:'rock',removed:null}];
  const frames=rockFrames(before,effects);
  assert.equal(frames[0].board['2,2'],'horizontal');
  assert.equal(frames[0].rock,'2,2');
  assert.ok(!('2,2' in frames[1].board));
  assert.equal(frames[2].board['2,1'],'horizontal');
  assert.deepEqual(frames[3].board,{});
  assert.equal(frames[4].rock,null);
  const observed=[];
  const waits=[];
  await playRockEffects(before,effects,frame=>observed.push(frame),async ms=>{waits.push(ms);});
  assert.deepEqual(observed,frames);
  assert.deepEqual(waits,[850,250,850,250,850,250]);
  assert.deepEqual(before,[{row:2,col:1,cardId:'horizontal'}]);
  assert.deepEqual(rockFrames(before,[{type:'draw'}]),[]);
});

test('PDF reference PMF/CDF and moments agree with the rounded input; draw models normalize', () => {
  const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-9,`${a} vs ${b}`);
  const model=distribution(baseline);
  near(baseline.reduce((a,b)=>a+b,0),1);
  near(model.mean,48.018);
  near(model.second,3920.52);
  near(model.variance,1614.791676);
  near(model.cdf(-1),0);near(model.cdf(0),.3876);
  near(model.cdf(59),.3876);near(model.cdf(60),.6082);
  near(model.cdf(79),.6082);near(model.cdf(80),.8281);near(model.cdf(100),1);
  near(scores.reduce((sum,_,i)=>sum+scenarios[1].pmf[i],0),1.0001);
  near(Array.from({length:14},(_,i)=>firstRockProbability(i+1)).reduce((a,b)=>a+b),1);
  near(Array.from({length:14},(_,i)=>(i+1)*firstRockProbability(i+1)).reduce((a,b)=>a+b),3.6);
  for(let n=0;n<=17;n++) near([0,1,2,3,4].reduce((sum,r)=>sum+rockCountProbability(n,r),0),1);
});

test('reconnecting multiple coin targets then consecutive rocks revokes only this turn before exhaustion', () => {
  for (const previousCoin of [false,true]) {
    const game=newGame('review',1,()=>.42,1000);
    game.goldRow=0;
    game.board={'2,1':'horizontal','2,3':'horizontal','2,4':'tee-down','3,4':'vertical','4,4':'bend-ur'};
    game.placed=Object.keys(game.board);
    game.hand=['horizontal'];
    game.deck=['rock','rock'];
    game.revealed=previousCoin ? [4] : [];
    game.coins=previousCoin ? 1 : 0;
    assert.equal(act(game,0,[2,2],2000),true);
    const revoked=game.events.filter(event=>event.type==='unreveal');
    assert.deepEqual(revoked.map(event=>event.row),previousCoin ? [2] : [2,4]);
    assert.equal(game.coins,previousCoin ? 1 : 0);
    assert.deepEqual(game.revealed,previousCoin ? [4] : []);
    assert.equal(game.reason,'exhausted');
    assert.equal(game.events.at(-1).type,'end');
    const frames=rockFrames([],game.events);
    assert.equal(frames.length,4, 'unreveal does not disrupt the two rock animations');
    const message=actionNotice(game.events);
    assert.match(message,/2 張落石/);
    assert.match(message,/第 3 列終點恢復未翻開|第 3 列終點、第 5 列終點恢復未翻開/);
    assert.match(message,/金幣已扣回/);
    assert.doesNotMatch(actionNotice([{type:'future-effect'}],true),/撤銷/);
  }
});
