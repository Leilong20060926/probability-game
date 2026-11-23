const names = { H: '橫向', V: '縱向', B: '彎道', X: '十字', R: '落石' };

export const payText = pay => Object.entries(pay || {})
  .filter(([, n]) => n)
  .map(([t, n]) => `${names[t] || t}×${n}`)
  .join('、') || '未選牌';

export function openingEffects(game) {
  if (!game || game.ruleset !== 'route-v1') return [];
  const rocks = game.publicConfig.deck.R - game.deckCounts.R;
  return [
    { type: 'map_start', mapIndex: game.mapIndex, mapId: game.mapId },
    {
      type: 'draw_summary',
      cards: { ...game.hand, R: rocks },
      a: game.a,
      ignored: rocks - game.a,
    },
  ];
}

export function routeEffectText(effect) {
  switch (effect.type) {
    case 'map_start': return `第 ${effect.mapIndex} 張探勘：抽到地圖${effect.mapId}，重新洗牌。`;
    case 'draw_summary': {
      let note = '';
      if (effect.ignored > 0) {
        note = `（累計超過 ${effect.a} 張，本次 ${effect.ignored} 張不計入加付）`;
      } else if (effect.cards.R > 0) {
        note = `（累計加付 ${effect.a} 張）`;
      }
      return `抽到：${payText(effect.cards)}${note}。`;
    }
    case 'pay': return `${effect.action === 'dig' ? '硬挖' : '鋪路'}：交出${payText(effect.pay)}。`;
    case 'exchange': return `換牌：棄掉${names[effect.discard] || effect.discard}。`;
    case 'advance': return '前進一段，補牌中。';
    case 'fork_ready': return '補牌完成，現在選擇 A 線或 B 線；落石成本帶入所選路線。';
    case 'choose_branch': return `已選擇 ${effect.choice} 線。`;
    case 'reveal': return effect.reward === 'gold' ? '找到金礦！' : '找到金幣！下一張地圖重新抽選。';
    case 'map_end': return effect.result === 'fail' ? '牌庫已空，無法再付牌通過路段。' : '這張地圖探勘完成。';
    case 'abandon': return '已提前結束探勘。';
    case 'end': return `本局結束，${effect.score ?? 0} 分。`;
    default: return '';
  }
}

export function routeEffectDuration(effect) {
  const text = routeEffectText(effect);
  if (!text) return 0;

  const chars = [...text.replace(/\s/g, '')].length;
  const minimum = effect.cards?.R > 0
    ? 2600
    : ['map_start', 'reveal'].includes(effect.type)
      ? 2000
      : effect.type === 'draw_summary'
        ? 2300
        : 1500;

  return Math.min(3800, Math.max(minimum, 650 + chars * 85));
}

function groupDrawEffects(effects) {
  const grouped = [];
  for (const effect of effects || []) {
    if (effect.type !== 'draw' && effect.type !== 'rock') {
      grouped.push(effect);
      continue;
    }

    let summary = grouped.at(-1);
    if (summary?.type !== 'draw_summary') {
      summary = {
        type: 'draw_summary',
        cards: { H: 0, V: 0, B: 0, X: 0, R: 0 },
        a: 0,
        ignored: 0,
      };
      grouped.push(summary);
    }

    if (effect.type === 'rock') {
      summary.cards.R++;
      summary.a = effect.a;
      if (effect.capped) summary.ignored++;
    } else {
      summary.cards[effect.card]++;
    }
  }
  return grouped;
}

export async function playRouteEffects(
  effects,
  onEffect,
  wait = ms => new Promise(resolve => setTimeout(resolve, ms)),
  reduced = false,
) {
  for (const effect of groupDrawEffects(effects)) {
    onEffect(effect);
    const duration = routeEffectDuration(effect);
    if (duration > 0) await wait(duration);
  }
  onEffect(null);
}