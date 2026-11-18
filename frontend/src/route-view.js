import {escapeHtml as e} from './storage.js';
export const CARD_TYPES=['H','V','B','X'];
export const CARD_NAMES={H:'橫向',V:'縱向',B:'彎道',X:'十字'};
export const CARD_IMAGES={H:'horizontal',V:'vertical',B:'bend-dr',X:'cross'};
export const SEGMENT_NAMES={HH:'平直通道',HV:'上坡通道',V:'縱向豎井',VV:'雙層豎井',H:'短橫道',B:'狹窄捷徑'};
export const emptyPay=()=>({H:0,V:0,B:0,X:0});
export const total=counts=>Object.values(counts||{}).reduce((a,b)=>a+b,0);
export function mapMarkup(game,config,{canChoose=false}={}) {
  const map=config.maps[game?.mapId||1],position=game?.position;
  const active=game?.status==='playing';
  const forkReady=active && game.phase==='fork';
  const reachedEnd=position?.kind==='end';
  const foundGold=reachedEnd && game.reason==='gold';
  function segment(code,kind,index) {
    const current=active && position?.kind===kind && position.index===index;
    const done=game && ((position?.kind==='end' && (kind==='first' || game.branch===kind)) || (kind==='first' && position?.kind!=='first')
      || (game.branch===kind && position?.kind===kind && position.index>index));
    const need=config.segments[code];
    return `<div class="route-segment ${current?'is-current':''} ${done?'is-done':''}" ${current?'aria-current="step"':''} role="group" aria-label="${kind==='first'?'第一段':kind+' 線第 '+(index+1)+' 段'}：${e(SEGMENT_NAMES[code]||code)}${done?'，已通過':current?'，目前位置':''}">
      <div class="route-segment-top"><span class="route-step">${String(kind==='first'?1:index+2).padStart(2,'0')}</span><span class="route-step-state">${current?'● 目前':done?'✓ 通過':'待探勘'}</span></div>
      <strong class="route-segment-name">${e(SEGMENT_NAMES[code]||code)}</strong>
      <div class="route-requirements">${CARD_TYPES.filter(t=>need[t]).map(t=>`<span class="route-need-chip" title="${CARD_NAMES[t]}牌 ${need[t]} 張" aria-label="${CARD_NAMES[t]}牌 ${need[t]} 張">${CARD_NAMES[t].slice(0,1)} ×${need[t]}</span>`).join('')}</div>
      ${current && game.a?`<small class="route-rock-cost" title="落石：另付任意 ${game.a} 張道路牌">🪨 +${game.a} 任意牌</small>`:''}</div>`;
  }
  function connection(merge=false) {
    return `<svg class="route-track-lines" viewBox="0 0 60 300" preserveAspectRatio="none" aria-hidden="true">${['A','B'].map((branch,i)=>{
      const y=i?225:75;
      const path=merge?`M0 ${y} H15 Q30 ${y} 30 ${y+(i?-15:15)} V${i?165:135} Q30 150 45 150 H60`:`M0 150 H15 Q30 150 30 ${i?165:135} V${y+(i?-15:15)} Q30 ${y} 45 ${y} H60`;
      return `<path d="${path}" class="${game?.branch===branch?'is-chosen':game?.branch?'is-unused':!merge && forkReady?'is-ready':''}"/>`;
    }).join('')}</svg>`;
  }
  return `<div class="route-map-viewport" tabindex="0" role="region" aria-label="橫向礦坑路線圖，從左側入口經第一段與 A、B 岔路前往右側終點，可左右捲動"><div class="route-map-flow">
    <div class="route-entrance"><span class="route-endpoint-icon" aria-hidden="true">⚒</span><strong>入口</strong><small>START</small></div>
    <div class="route-first">${segment(map.first,'first',0)}</div>
    <div class="route-fork ${forkReady?'is-current':''}" ${forkReady?'aria-current="step"':''}>${connection()}<div class="route-fork-marker"><span aria-hidden="true"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12h7m0 0V6h11m-11 6v6h11m-3-15 3 3-3 3m0 6 3 3-3 3"/></svg></span><strong>岔路</strong></div></div>
    <div class="route-branches">${['A','B'].map(branch=>`<section class="route-branch ${game?.branch===branch?'is-chosen':game?.branch?'is-unused':forkReady?'is-available':''}" aria-label="${branch} 線，共 ${map[branch].length} 段">
      <div class="route-lane-heading">${forkReady?`<button type="button" data-action="branch-${branch}" ${canChoose?'':'disabled'}>選 ${branch} 線 <span aria-hidden="true">→</span></button>`:`<h3><b>${branch}</b> ${branch} 線${game?.branch===branch?' · 已選':''}</h3>`}<small>${map[branch].length} 段路程</small></div>
      <div class="route-lane-stages" style="--route-stage-count:${map[branch].length}">${map[branch].map((code,i)=>segment(code,branch,i)).join('')}</div></section>`).join('')}</div>
    <div class="route-merge">${connection(true)}</div><div class="route-goal ${foundGold?'is-revealed':''}"><span class="route-endpoint-icon" aria-hidden="true">${foundGold?'✦':'?'}</span><strong>${foundGold?'金礦':'藏礦'}</strong><small>${foundGold?'已發現':'抵達揭曉'}</small></div>
    </div></div><div class="route-map-legend"><span><i class="legend-current"></i>目前位置</span><span><i class="legend-done"></i>已通過</span><span><i class="legend-future"></i>未探索</span><span class="route-pan-hint">左右滑動查看路線 ↔</span>${forkReady?`<strong>已補完牌 · 請選岔路${game.a?' · 落石加付 '+game.a+' 張':''}</strong>`:''}</div>`;
}
export function handMarkup(hand,selected,enabled) {
  return CARD_TYPES.map(t=>`<div class="route-card ${selected[t]?'is-selected':''}"><button type="button" data-card="${t}" aria-label="選一張${CARD_NAMES[t]}牌，已選 ${selected[t]}，手上 ${hand[t]}" ${!enabled || selected[t]>=hand[t]?'disabled':''}>
    <img src="/assets/cards/${CARD_IMAGES[t]}.png" alt=""><strong>${CARD_NAMES[t]} <small>×${hand[t]}</small></strong></button>
    <div class="route-card-count"><button type="button" data-remove="${t}" aria-label="取消一張${CARD_NAMES[t]}牌" ${!enabled || !selected[t]?'disabled':''}>−</button><span aria-label="已選 ${selected[t]} 張"><span class="route-selected-label">已選 </span>${selected[t]}</span><button type="button" data-card="${t}" aria-label="再選一張${CARD_NAMES[t]}牌" ${!enabled || selected[t]>=hand[t]?'disabled':''}>＋</button></div></div>`).join('');
}
