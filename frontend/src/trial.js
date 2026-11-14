// Explicit, disposable practice mode. No fetch, cookies, or browser storage.
import {newGame, act, abandon, checkTimeout} from './engine.js';

export function createTrial() {
  let playerId = crypto.randomUUID();
  let attempt = 0;
  let game = null;

  function view() {
    if (!game) return null;
    if (checkTimeout(game)) game.revision++;
    return {
      id:game.id, playerId, attempt, version:game.version, revision:game.revision,
      mode:'trial', source:'human', config:{...game.config}, status:game.status,
      startedAt:game.startedAt, deadlineAt:game.startedAt + game.config.seconds * 1000,
      serverNow:Date.now(), endedAt:game.endedAt, hand:[...game.hand],
      deckRemaining:game.deck.length,
      board:Object.entries(game.board).map(([position,cardId]) => {
        const [row,col] = position.split(',').map(Number);
        return {row,col,cardId};
      }),
      targets:[0,2,4].map(row => game.revealed.includes(row)
        ? {row,revealed:true,reward:row === game.goldRow ? 'gold' : 'coin'}
        : {row,revealed:false}),
      coins:game.coins, turn:game.turn, score:game.score, reason:game.reason ?? null,
    };
  }

  return async function trial(path, {body = {}} = {}) {
    if (path === '/api/players/switch') {
      playerId = crypto.randomUUID(); attempt = 0; game = null;
      return {playerId,nextAttempt:1};
    }
    if (path === '/api/players') return {playerId,nextAttempt:attempt+1};
    if (path === '/api/games/current') return view();
    if (path === '/api/games') {
      view();
      if (game?.status === 'playing') throw new Error('請先結束目前試玩。');
      game = newGame(playerId, ++attempt);
      game.revision = 0;
      return view();
    }
    if (!game || !path.startsWith('/api/games/' + game.id + '/')) throw new Error('找不到試玩遊戲。');
    view();
    const before = game.events.length;
    if (path.endsWith('/actions')) {
      if (game.status === 'finished') return {game:view(),effects:[{type:'end'}]};
      if (body.type === 'abandon') abandon(game);
      else if (!act(game, body.handIndex, body.type === 'place' ? [body.row,body.col] : null)) {
        throw new Error('無效的試玩操作。');
      }
      game.revision++;
    } else if (!path.endsWith('/lifecycle')) throw new Error('未知的試玩操作。');
    // Lifecycle observations are not collected in practice mode.
    return {game:view(), effects:game.events.slice(before).map(event => ({
      type:event.type, cardId:event.cardId, position:event.position, removed:event.removed,
    }))};
  };
}
