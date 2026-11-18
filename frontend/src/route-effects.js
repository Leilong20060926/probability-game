const names={H:'橫向',V:'縱向',B:'彎道',X:'十字'};
export const payText=pay=>Object.entries(pay||{}).filter(([,n])=>n).map(([t,n])=>`${names[t]||t}×${n}`).join('、')||'未選牌';
export function routeEffectText(effect) {
  const location=effect.pos==='K'?'岔路':effect.pos==='F'?'第一段':'新路段';
  switch(effect.type) {
    case 'map_start':return `第 ${effect.mapIndex} 張探勘：抽到地圖${effect.mapId}，重新洗牌。`;
    case 'draw':return `補到${names[effect.card]||effect.card}牌。`;
    case 'rock':return effect.capped?`抽到落石！${location}加付已達上限 ${effect.a} 張，這張不再增加。`:`抽到落石！${location}累積加付 ${effect.a} 張任意牌。`;
    case 'pay':return `${effect.action==='dig'?'硬挖':'鋪路'}：交出${payText(effect.pay)}。`;
    case 'exchange':return `換牌：棄掉${names[effect.discard]||effect.discard}。`;
    case 'advance':return '前進一段，補牌中。';
    case 'fork_ready':return '補牌完成，現在選擇 A 線或 B 線；落石成本帶入所選路線。';
    case 'choose_branch':return `已選擇 ${effect.choice} 線。`;
    case 'reveal':return effect.reward==='gold'?'找到金礦！':'找到金幣！下一張地圖重新抽選。';
    case 'map_end':return effect.result==='fail'?'牌庫已空，無法再付牌通過路段。':'這張地圖探勘完成。';
    case 'abandon':return '已提前結束探勘。';
    case 'end':return `本局結束，${effect.score??0} 分。`;
    default:return '';
  }
}
export async function playRouteEffects(effects,onEffect,wait=ms=>new Promise(resolve=>setTimeout(resolve,ms)),reduced=false) {
  for(const effect of effects||[]) {
    onEffect(effect);
    const duration=effect.type==='rock'?1000:effect.type==='reveal'?800:effect.type==='map_start'?400:60;
    if(!reduced)await wait(duration);
  }
  onEffect(null);
}
