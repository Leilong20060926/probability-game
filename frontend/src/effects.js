// Visual replay of confirmed public effects; never changes authoritative rules/state.
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
