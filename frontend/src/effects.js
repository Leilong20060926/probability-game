// Visual replay of confirmed public effects; never changes authoritative rules/state.
export function actionNotice(effects, trial = false) {
  const rocks = effects.filter(effect => effect.type === 'rock').length;
  const revoked = [...new Set(effects.filter(effect => effect.type === 'unreveal').map(effect => effect.row))];
  const messages = [];
  if (rocks) messages.push(`遇到 ${rocks} 張落石，已更新礦坑。`);
  if (revoked.length) {
    const targets = revoked.map(row => Number.isInteger(row) ? `第 ${row + 1} 列終點` : '終點').join('、');
    messages.push(`落石撤銷本回合翻牌：${targets}恢復未翻開，金幣已扣回。`);
  }
  return messages.join(' ') || (trial ? '試玩操作完成，本局不記錄。' : '操作已由伺服器確認。');
}

export function rockFrames(before, effects) {
  const board = Object.fromEntries(before.map(cell => [`${cell.row},${cell.col}`,cell.cardId]));
  const frames = [];
  for (const effect of effects) {
    if (effect.type === 'place' && effect.position) board[effect.position.join(',')] = effect.cardId;
    if (effect.type !== 'rock') continue;
    frames.push({board:{...board},rock:effect.removed ?? null,phase:'warning'});
    if (effect.removed) delete board[effect.removed];
    frames.push({board:{...board},rock:effect.removed ?? null,phase:'removed'});
  }
  return frames;
}

export async function playRockEffects(before, effects, show, wait = ms => new Promise(resolve=>setTimeout(resolve,ms))) {
  for (const frame of rockFrames(before,effects)) {
    show(frame);
    await wait(frame.phase === 'warning' ? 850 : 250);
  }
}
