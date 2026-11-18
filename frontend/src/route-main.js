import {mountRouteApp} from './route-app.js?v=score-captions-2';
import {api} from './storage.js';
import {createFeedbackPrompt} from './feedback.js';

const markerKey = 'probability-game:feedback-observed';
let observed = null, playerId = null, ui = null;
let feedbackTarget = null, probeKey = null;
const submittedPlayers = new Set();

try {
  const saved = JSON.parse(sessionStorage.getItem(markerKey));
  if (typeof saved?.playerId === 'string' && typeof saved?.gameId === 'string') {
    observed = saved;
  }
} catch {}

function remember(value) {
  observed = value;
  try {
    if (value) sessionStorage.setItem(markerKey, JSON.stringify(value));
    else sessionStorage.removeItem(markerKey);
  } catch {}
}

async function requestFeedback(path, options) {
  const gameId = observed?.gameId;
  const requestPath = gameId && !options?.body
    ? `${path}?gameId=${encodeURIComponent(gameId)}` : path;
  const requestOptions = gameId && options?.body
    ? {...options, body: {...options.body, gameId}} : options;
  const result = await api(requestPath, requestOptions);

  if (result?.submitted && result.playerId) {
    submittedPlayers.add(result.playerId);
    if (observed?.playerId === result.playerId && observed.gameId === gameId) {
      remember(null);
    }
    if (feedbackTarget?.playerId === result.playerId) feedbackTarget = null;
    setTimeout(() => ui?.refresh(), 0);
  }
  return result;
}

const feedback = createFeedbackPrompt({request: requestFeedback});

function inspectFinished(game) {
  const key = `${game.playerId}:${game.id}`;
  if (probeKey === key) return;
  probeKey = key;
  feedbackTarget = {playerId: game.playerId, gameId: game.id};

  // 只在背景確認資格；成績畫面不等待問卷 API，也不自動開問卷。
  void requestFeedback('/api/feedback').then(status => {
    if (probeKey !== key || playerId !== game.playerId) return;
    if (status.playerId !== playerId) return;
    if (submittedPlayers.has(playerId) || !status.required) feedbackTarget = null;
    ui?.refresh();
  }).catch(() => {
    // 問卷服務暫時失敗時仍保留成績，玩家按下一步可重新連線。
    if (probeKey === key && playerId === game.playerId) ui?.refresh();
  });
}

ui = mountRouteApp(document.querySelector('#app'), {
  feedback: {
    required: game => feedbackTarget?.playerId === game.playerId &&
      feedbackTarget?.gameId === game.id && !submittedPlayers.has(game.playerId),
    open: game => {
      if (feedbackTarget?.playerId === game.playerId && feedbackTarget.gameId === game.id) {
        feedback.check();
      }
    },
  },
  server: async (path, options) => {
    const result = await api(path, options);

    if (path === '/api/players' || path === '/api/players/switch') {
      if (path === '/api/players/switch') remember(null);
      if (playerId !== result.playerId) {
        playerId = result.playerId;
        feedbackTarget = null;
        probeKey = null;
        if (observed && observed.playerId !== playerId) remember(null);
        feedback.setPlayer(playerId);
      }
    }

    if (result?.playerId === playerId && result.ruleset === 'route-v1' &&
        !submittedPlayers.has(playerId)) {
      if (path === '/api/games' && result.id) {
        feedbackTarget = null;
        probeKey = null;
        remember({playerId, gameId: result.id});
      }
      if (path === '/api/games/current') {
        if (result.status === 'playing') {
          remember({playerId, gameId: result.id});
        } else if (result.status === 'finished' &&
                   observed?.gameId === result.id && observed.playerId === playerId) {
          inspectFinished(result);
        }
      }
    }
    return result;
  },
});
