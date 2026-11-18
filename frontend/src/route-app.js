import {makeConfig,publicConfig,ROUTE_VERSION} from '../../shared/route-config.js';
import {legalActions,posFromObject} from '../../shared/route-analysis.js';
import {api as serverApi,escapeHtml as e,lifecycleRequest} from './storage.js';
import {routeCreateRequest,routeActionRequest} from './route-storage.js';
import {createRouteTrial} from './route-trial.js';
import {createLocalAdvisor} from './route-advisor.js';
import {mapMarkup,handMarkup,CARD_TYPES,CARD_NAMES,emptyPay,total} from './route-view.js';
import {payText,routeEffectText,playRouteEffects} from './route-effects.js';
import {mountViewportFit} from './route-fit.js';

const tutorial=[
  ['三地圖探勘','每張地圖都有第一段與 A/B 岔路。找到金幣會重新抽圖、重洗牌；找到金礦才結算分數。','.route-map'],
  ['路段與落石','看目前路段需要哪些方向牌。落石讓這一段多付任意牌，每段最多多付 3 張；通過路段後歸零，新抽的落石加在新位置。','.route-map'],
  ['選牌付款','點手牌或「＋」選取，點「−」取消。十字能代替一張方向牌；選好後再按鋪路或硬挖。','.route-hand'],
  ['三種動作','鋪路付需求＋落石成本；硬挖付任意 3＋落石成本。換牌則選一張，棄掉再抽一張，牌庫須有牌。','.route-hand'],
  ['補完牌再選路','到岔路先補完牌，再選 A 或 B。選路不算動作，累積的落石成本會帶進所選線第一段。','.route-map'],
  ['倒數與計分','整局共 300 秒，切換頁面和教學都不暫停。金礦 60 分＋每枚金幣 20 分；失敗、超時或提前結束為 0 分。','.route-status'],
  ['由你決定是否記錄','開始前選不記錄試玩或記錄資料，再按開始探勘。試玩只在本頁記憶體；記錄模式由伺服器保存。','.route-session-controls'],
];
const reasons={gold:'成功找到金礦',exhausted:'牌已用盡，無法通過路段',timeout:'探勘時間結束',abandoned:'已提前結束'};

export function mountRouteApp(app,{server=serverApi,trialFactory=createRouteTrial,advisor=createLocalAdvisor(),clock=()=>performance.now(),interval=setInterval,wait,reducedMotion=()=>globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches,confirm=message=>globalThis.confirm(message)}={}) {
  const config=publicConfig(makeConfig());
  const viewportFit=mountViewportFit(app);
  let mode=null,trial=null,game=null,player={nextAttempt:1},selected=emptyPay(),connected=false,busy=false,pending=null,notice='';
  let serverTime=0,receivedAt=0,restoreRequest=null,effect=null,helpStep=0,resultHidden=false;
  let hintOpen=false,hintLoading=false,hints=null,hintError='',hintToken=0;
  const lifecycleQueue=[];
  let mapFocusKey='';
  const isRoute=()=>game?.ruleset==='route-v1';
  const active=()=>game?.status==='playing';
  const remaining=()=>game?Math.max(0,Math.ceil((game.deadlineAt-serverTime-(clock()-receivedAt))/1000)):300;
  const playable=()=>!!(mode && connected && !busy && !pending && isRoute() && active() && remaining()>0);
  const canChange=()=>!busy && !active() && (!pending || pending.kind==='initialize');
  const request=(path,options)=>mode==='trial'?trial(path,options):server(path,options);
  function clearHints(){hintToken++;hints=null;hintLoading=false;hintError='';}
  function accept(view) {
    if(game?.id!==view?.id || game?.revision!==view?.revision){selected=emptyPay();clearHints();}
    if(game?.id!==view?.id || game?.status!==view?.status)resultHidden=false;
    game=view;
    if(view){serverTime=view.serverNow;receivedAt=clock();}
    if(view?.status==='finished'){helpStep=-1;hintOpen=false;lifecycleQueue.length=0;}
  }
  async function current(){accept(await request('/api/games/current'));}
  async function run(operation,kind='action') {
    if(busy)return false;
    busy=true;pending={operation,kind};notice=mode==='trial'?'正在處理試玩…':'正在等待伺服器確認…';render();
    try {await operation();pending=null;connected=true;return true;}
    catch(error){
      selected=emptyPay();clearHints();
      if(['REVISION_CONFLICT','GAME_IN_PROGRESS'].includes(error.code)) {
        try{await current();pending=null;connected=true;notice=error.code==='GAME_IN_PROGRESS'?'已有進行中的探勘，已取得最新狀態。':'本局已被其他操作更新，請重新選牌。';}
        catch{connected=false;pending={operation:current,kind:'sync'};notice='無法同步狀態，請重試連線。';}
      }else{
        connected=false;
        if(error.status && error.status<500){pending={operation:current,kind:'sync'};notice=error.message+'，請先同步再操作。';}
        else notice='連線失敗，操作結果尚未確認。請按重試，會沿用同一識別碼。';
      }
      return false;
    }finally{
      busy=false;render();
      if(connected && !pending && lifecycleQueue.length){const next=lifecycleQueue.shift();sendLifecycle(next);}
    }
  }
  async function initialize() {
    player=await request('/api/players',{body:{}});await current();
    // 上一局已結束時不帶回結果視窗，否則一進記錄模式就像「開局先死一次」。
    if(game?.status==='finished')game=null;
    if(isRoute() && active()){
      const path=`/api/games/${game.id}/lifecycle`;
      if(restoreRequest?.path!==path)restoreRequest=lifecycleRequest(game,'restored');
      await request(restoreRequest.path,restoreRequest.options);await current();restoreRequest=null;
    }
    notice=mode==='trial'?'不記錄試玩 · 本局未儲存。':active()?'已恢復伺服器上的探勘。':'已選記錄資料，準備開始。';
  }
  function chooseMode(next){if(busy || active() || pending)return;mode=next;trial=next==='trial'?trialFactory():null;return run(initialize,'initialize');}
  function changeMode(){if(!canChange())return;mode=null;trial=null;game=null;player={nextAttempt:1};pending=null;connected=false;selected=emptyPay();clearHints();advisor.dispose();hintOpen=false;notice='';restoreRequest=null;lifecycleQueue.length=0;render();}
  function start() {
    if(!mode || !connected || busy || pending || active())return;
    const req=routeCreateRequest(globalThis.matchMedia?.('(pointer: coarse)').matches?'touch':'pointer');
    return run(async()=>{await request(req.path,req.options);await current();notice=game?.a?`開局抽到落石，第一段另付 ${game.a} 張（每段最多 3 張）。`:'選牌後，按鋪路、硬挖或換牌。';});
  }
  function submit(action) {
    if(!playable() && !(active() && !isRoute() && action.type==='abandon' && !busy && !pending && connected))return;
    const req=routeActionRequest(game,action);
    clearHints();
    return run(async()=>{
      const response=await request(req.path,req.options);
      try{await playRouteEffects(response.effects,x=>{effect=x;render();},wait,reducedMotion());}finally{effect=null;}
      await current();notice=game?.status==='finished'?reasons[game.reason]:'操作已確認，請繼續探勘。';
    });
  }
  function select(type,delta=1){if(!playable() || game.phase!=='segment')return;selected[type]=Math.max(0,Math.min(game.hand[type],selected[type]+delta));render();}
  function retry(){if(pending)return run(pending.operation,pending.kind);}
  function sendLifecycle(type) {
    if(mode!=='server' || !isRoute() || !active())return;
    const req=typeof type==='string'?lifecycleRequest(game,type):type;
    if(busy || pending){lifecycleQueue.push(req);return;}
    if(req.path!==`/api/games/${game.id}/lifecycle`)return;
    return run(async()=>{await request(req.path,req.options);await current();notice='已同步目前探勘。';},'lifecycle');
  }
  async function queryHints() {
    if(!isRoute() || !active())return;
    const token=++hintToken,snapshot=structuredClone(game);
    hintLoading=true;hintError='';hints=null;render();
    try{
      const result=mode==='trial'?await advisor.query(snapshot):await server(`/api/games/${encodeURIComponent(snapshot.id)}/hints`);
      if(token!==hintToken || !hintOpen)return;
      if(game.id!==result.gameId || game.revision!==result.revision || game.configId!==result.configId){hintError='狀態已更新，請重新取得提示。';if(!remaining() && !busy && !pending)run(current,'sync');}
      else hints=result;
    }catch(error){if(token===hintToken)hintError=error.message||'提示暫時無法取得，請重試。';}
    finally{if(token===hintToken){hintLoading=false;render();}}
  }
  function openHints() {
    if(!playable())return;
    if(hintOpen)return queryHints();
    hintOpen=true;
    if(mode==='trial')return queryHints();
    const req=lifecycleRequest(game,'hint_shown');
    return run(async()=>{await request(req.path,req.options);await current();if(active())queryHints();notice='提示不含時間與提前結束，倒數照常。';},'lifecycle');
  }
  function applyHint(index) {
    if(!playable() || !hints || hints.revision!==game.revision)return;
    const action=hints.options[index]?.action;if(!action)return;
    if(action.pay)selected={...action.pay};
    else if(action.type==='exchange')selected={...emptyPay(),[action.discard]:1};
    render();
  }
  function nextPlayer(){if(active() || busy || pending)return;return run(async()=>{player=await request('/api/players/switch',{body:{}});await current();clearHints();advisor.dispose();notice='已換下一位玩家。';});}
  function actions() {
    if(!isRoute() || !active() || game.phase!=='segment')return [];
    return legalActions(game.publicConfig,String(game.mapId),posFromObject(game.position),game.a,CARD_TYPES.map(t=>game.hand[t]),['H','V','B','X','R'].map(t=>game.deckCounts[t]));
  }
  function paymentAllowed(type){return playable() && actions().some(a=>a.type===type && CARD_TYPES.every((t,i)=>selected[t]===a.pay[i]));}
  function hintMarkup() {
    if(!hintOpen)return '';
    return `<section class="route-hints" aria-label="精確提示"><h3>本張地圖通關率</h3><p>做此動作後，其餘採最佳策略；忽略超時與放棄。</p>${hintLoading?'<p role="status">背景計算中，可繼續操作…</p>':hintError?`<p role="status">${e(hintError)}</p><button data-action="hint-retry">重新取得提示</button>`:hints?`<ol>${hints.options.map((row,i)=>`<li class="${row.best?'is-best':''}"><strong>${row.best?'★ 最佳 · ':''}${row.action.type==='choose_branch'?row.action.branch+' 線':row.action.type==='exchange'?'換掉'+CARD_NAMES[row.action.discard]:(row.action.type==='dig'?'硬挖':'鋪路')+' '+payText(row.action.pay)}</strong><span>${e(row.value.numerator)}/${e(row.value.denominator)} ≈ ${(Number(row.value.decimal)*100).toFixed(2)}%</span>${row.action.type!=='choose_branch'?`<button data-hint="${i}" ${!playable()?'disabled':''}>選取此付法</button>`:''}</li>`).join('')}</ol>`:'<p>狀態已更新，請重新取得提示。</p><button data-action="hint-retry">重新取得提示</button>'}<button data-action="hint-close">收起提示</button></section>`;
  }
  function render() {
    const previous=globalThis.document?.activeElement?.dataset?.key;
    const previousPan=app.querySelector('.route-map-viewport')?.scrollLeft||0;
    const route=isRoute(),playing=active(),view=route?game:null,displayConfig=view?.publicConfig||config;
    const n=total(selected),canExchange=playable() && game.phase==='segment' && n===1 && game.deckRemaining>0;
    const legacy=playing && !route;
    app.innerHTML=`<div class="route-game ${playing?'is-playing':''}" role="main"><header class="route-header"><div><strong>⚒ 黃金探勘所</strong><span>三地圖路段版 · v${ROUTE_VERSION}</span></div><strong id="route-mobile-clock" aria-label="剩餘探勘時間">${formatTime(remaining())}</strong><button data-action="help">使用教學</button></header>
      <div class="route-layout"><section class="route-map route-panel"><div class="route-panel-title"><h1>${view?`第 ${view.mapIndex} 張探勘 · 地圖${view.mapId}`:'三種地圖，逐段探勘'}</h1><span>${view?.phase==='fork'?'請選 A / B 線':view?.branch?view.branch+' 線':view?'第一段':'示意：地圖一'}</span></div>
      ${mapMarkup(view,displayConfig,{canChoose:playable()})}<p class="route-map-caption">每張地圖獨立隨機抽選，可重複；金幣後全部重洗。</p>
      ${effect?`<div class="route-effect ${effect.type==='rock'?'is-rock':''}" role="status">${e(routeEffectText(effect))}</div>`:''}</section>
      <aside class="route-status route-panel"><div class="route-clock-label">整局剩餘時間</div><strong id="route-clock" class="route-clock">${formatTime(remaining())}</strong><div class="route-timer-track"><i id="route-time-bar" style="width:${remaining()/3}%"></i></div>
      <div class="route-stats"><div>金幣<strong>${view?.coins??0} / 2</strong></div><div>動作數<strong>${view?.turn??0}</strong></div></div>
      <p class="route-demand">${view?.phase==='fork'?`岔路累積落石：加付 ${view.a} 張` :playing && route?`本段鋪路 ${view.paveCost} 張 · 硬挖 ${view.digCost??'不可用'} 張`:'找到金礦 60 分，每枚金幣再加 20 分；失敗為 0 分。'}</p>
      ${view?.completedMaps.length?`<div class="route-history">${view.completedMaps.map(m=>`<span>第${m.mapIndex}張／圖${m.mapId}：${m.result==='coin'?'金幣':m.result==='gold'?'金礦':'失敗'}</span>`).join('')}</div>`:''}
      ${route && playing?`<button data-action="hint" ${!playable()?'disabled':''}>查看精確提示</button>`:''}${hintMarkup()}
      <div class="route-session-controls"><div class="route-mode"><strong>${mode==='trial'?'不記錄試玩':mode==='server'?'記錄資料':'是否記錄本局資料？'}</strong>${!mode?'<div><button data-action="trial">不記錄試玩</button><button data-action="server">記錄資料</button></div>':`<button data-action="mode" ${!canChange()?'disabled':''}>切換紀錄模式</button>`}</div>
      ${legacy?`<p>舊版 grid 探勘尚未結束。結束舊局會以提前結束、0 分保存，之後才能玩三地圖。</p><button class="route-primary" data-action="end-grid" ${busy || pending || !connected?'disabled':''}>結束舊局，準備三地圖</button>`:!playing?`<button class="route-primary" data-action="start" ${!mode || !connected || busy || pending?'disabled':''}>${view?'再探勘一次':'開始探勘'} →</button>`:`<button data-action="end" ${!playable()?'disabled':''}>提前結束本局</button>`}
      ${game && !playing?`<button data-action="next" ${busy || pending?'disabled':''}>換下一位玩家</button>${route?'<button data-action="result">查看本局成績</button>':''}`:''}
      <p class="route-notice" role="status">${e(notice)}</p>${pending && !busy?'<button class="route-primary" data-action="retry">重試連線／同步</button>':''}</div></aside>
      <section class="route-hand route-panel"><div class="route-panel-title"><h2>你的道路牌 <small>${route?total(game.hand):0} 張</small></h2><div>剩餘牌庫 ${view?.deckRemaining??16} 張 · ${['H','V','B','X','R'].map(t=>`${t==='R'?'落石':CARD_NAMES[t]} ${view?.deckCounts[t]??config.deck[t]}`).join(' · ')}</div></div>
      <div class="route-hand-row">${handMarkup(view?.hand||emptyPay(),selected,playable() && game.phase==='segment')}</div>${view?.phase==='fork' && playing?'<p class="route-fork-instruction">先看補完的手牌，再按地圖上的 A／B 線。</p>':`<div class="route-play-controls"><span>已選 ${n} 張：${e(payText(selected))}</span><button data-action="clear" ${!n || !playable()?'disabled':''}>清除</button><button class="route-primary" data-action="pave" ${!paymentAllowed('pave')?'disabled':''}>鋪路</button><button data-action="dig" ${!paymentAllowed('dig')?'disabled':''}>硬挖</button><button data-action="exchange" ${!canExchange?'disabled':''}>換牌</button></div>`}</section></div>
      ${helpStep>=0?`<section class="route-tutorial" role="dialog" aria-modal="false" aria-labelledby="route-help-title"><small>探勘教學 ${helpStep+1} / ${tutorial.length}</small><h2 id="route-help-title">${tutorial[helpStep][0]}</h2><p>${tutorial[helpStep][1]}</p><div><button data-action="help-close">跳過教學</button>${helpStep?'<button data-action="help-back">上一步</button>':''}<button class="route-primary" data-action="help-next">${helpStep===tutorial.length-1?'開始準備':'下一步'}</button></div></section>`:''}
      ${route && game.status==='finished' && !resultHidden && helpStep<0?`<div class="route-backdrop"><section class="route-result" role="dialog" aria-modal="true" aria-labelledby="route-result-title" tabindex="-1"><img src="/assets/targets/${game.reason==='gold'?'golden':'coin'}.png" alt=""><h2 id="route-result-title">${e(reasons[game.reason]||'探勘結束')}</h2><strong>${game.score} 分</strong><p>找到 ${game.coins} 枚金幣 · ${game.turn} 次動作</p><p>${mode==='trial'?'本局未記錄。':'本局由伺服器保存。'}</p><button data-action="result-close">先看探勘路線</button><button class="route-primary" data-action="start" ${busy || pending?'disabled':''}>再探勘一次</button><button data-action="next" ${busy || pending?'disabled':''}>換下一位玩家</button></section></div>`:''}</div>`;
    app.querySelectorAll('[data-card]').forEach(button=>{button.dataset.key='card-'+button.dataset.card;button.onclick=()=>select(button.dataset.card);});
    app.querySelectorAll('[data-remove]').forEach(button=>{button.dataset.key='remove-'+button.dataset.remove;button.onclick=()=>select(button.dataset.remove,-1);});
    app.querySelectorAll('[data-hint]').forEach(button=>button.onclick=()=>applyHint(Number(button.dataset.hint)));
    app.querySelectorAll('[data-action]').forEach(button=>{button.dataset.key=button.dataset.action;button.onclick=()=>handle(button.dataset.action);});
    viewportFit.update();
    const viewport=app.querySelector('.route-map-viewport');
    if(viewport){
      viewport.scrollLeft=previousPan;
      const key=view?[view.id,view.mapIndex,view.position.kind,view.position.index].join(':'):'preview';
      if(key!==mapFocusKey){
        const target=viewport.querySelector('[aria-current="step"]');
        if(target){const bounds=target.getBoundingClientRect(),frame=viewport.getBoundingClientRect(),scale=frame.width/viewport.clientWidth||1;viewport.scrollLeft+=((bounds.left+bounds.width/2)-(frame.left+frame.width/2))/scale;}
        else viewport.scrollLeft=0;
        mapFocusKey=key;
      }
    }
    if(helpStep>=0)app.querySelector(tutorial[helpStep][2])?.classList.add('route-tour-focus');
    if(previous)app.querySelector(`[data-key="${previous}"]`)?.focus({preventScroll:true});
    if(route && game.status==='finished' && !resultHidden && helpStep<0)app.querySelector('.route-result')?.focus({preventScroll:true});
  }
  function handle(action) {
    switch(action){
      case 'trial':return chooseMode('trial');case 'server':return chooseMode('server');case 'mode':return changeMode();case 'start':return start();case 'retry':return retry();case 'next':return nextPlayer();
      case 'clear':selected=emptyPay();return render();
      case 'pave':case 'dig':if(paymentAllowed(action))return submit({type:action,pay:{...selected}});return;
      case 'exchange':if(playable() && total(selected)===1)return submit({type:'exchange',discard:CARD_TYPES.find(t=>selected[t])});return;
      case 'branch-A':case 'branch-B':return submit({type:'choose_branch',branch:action.at(-1)});
      case 'end':if(confirm('確定提前結束？本局得分為 0。'))return submit({type:'abandon'});return;
      case 'end-grid':if(confirm('確定結束舊版探勘？舊局以提前結束、0 分保存，再由你開始三地圖。'))return submit({type:'abandon'});return;
      case 'hint':case 'hint-retry':return openHints();case 'hint-close':hintOpen=false;clearHints();return render();
      case 'help':helpStep=0;return render();case 'help-close':helpStep=-1;return render();case 'help-back':helpStep=Math.max(0,helpStep-1);return render();case 'help-next':helpStep=helpStep===tutorial.length-1?-1:helpStep+1;return render();
      case 'result':resultHidden=false;return render();case 'result-close':resultHidden=true;return render();
    }
  }
  globalThis.document?.addEventListener('visibilitychange',()=>sendLifecycle(globalThis.document.hidden?'hidden':'visible'));
  globalThis.document?.addEventListener('keydown',event=>{
    if(app.hidden)return;
    if(event.key==='Escape'){if(helpStep>=0)helpStep=-1;else resultHidden=true;render();}
    const dialog=app.querySelector('.route-result');
    if(event.key==='Tab' && dialog){const items=[...dialog.querySelectorAll('button:not(:disabled)')];if(!items.length)return;const first=items[0],last=items.at(-1);if(event.shiftKey && (document.activeElement===first || document.activeElement===dialog)){event.preventDefault();last.focus();}else if(!event.shiftKey && (document.activeElement===last || document.activeElement===dialog)){event.preventDefault();first.focus();}}
  });
  interval(()=>{
    if(!active())return;
    const el=app.querySelector('#route-clock');if(el)el.textContent=formatTime(remaining());
    const mobile=app.querySelector('#route-mobile-clock');if(mobile)mobile.textContent=formatTime(remaining());
    const bar=app.querySelector('#route-time-bar');if(bar)bar.style.width=`${remaining()/3}%`;
    if(!remaining() && !busy && !pending)run(current,'sync');
  },250);
  render();
  return {chooseMode,start,submit,select,retry,changeMode,openHints,handle,nextPlayer,
    get state(){return {game:game&&structuredClone(game),mode,busy,pending:pending?.kind,connected,selected:{...selected},notice,hints,hintLoading,hintError};}};
}
function formatTime(seconds){return `${Math.floor(seconds/60).toString().padStart(2,'0')}:${(seconds%60).toString().padStart(2,'0')}`;}
