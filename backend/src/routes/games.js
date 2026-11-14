import { clock } from '../clock.js';
import { readJsonBody, sendJson } from '../http.js';
import { errors } from '../errors.js';
import { readPlayerSession } from '../session.js';
import {
  getGame,
  getLatestGameForPlayer,
  getPlayingGameForPlayer,
  insertEvents,
  insertGame,
  saveGame,
} from '../games-repo.js';
import { incrementAttempt } from '../players-repo.js';
import { toSafeGameView, effectsSince } from '../gameView.js';
import { findIdempotent, hashRequest, storeIdempotent } from '../idempotency.js';
import { abandon, act, checkTimeout, newGame, recordLifecycle } from '../engine-adapter.js';

function requirePlayer(db, req) {
  const session = readPlayerSession(db, req);
  if (!session) throw errors.unauthorized('請先呼叫 POST /api/players 建立玩家 session');
  return session.player;
}

function ownedGame(game, player) {
  if (!game || game.playerId !== player.id) {
    throw errors.notFound('找不到這場遊戲');
  }
  return game;
}

// 所有會改動資料的操作都包在這裡：DB 寫入與冪等回應紀錄要在同一筆交易內，
// 程序中斷也不會留下「狀態已變但沒有重試紀錄」的半套結果（Codex review P2）。
function withTransaction(db, fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

function persistEvents(db, game, fromSeqExclusive, now) {
  insertEvents(db, game.id, game.events, fromSeqExclusive);
  saveGame(db, game, now);
}

export function registerGameRoutes(routes, db) {
  routes.push({
    method: 'POST',
    pattern: /^\/api\/games$/,
    handler: async (req, res) => {
      const player = requirePlayer(db, req);
      // 先把 body 讀完，再去讀會被併發行動影響的遊戲列；見下方 actions/lifecycle
      // 的註解——讀取與處理之間不能有 await，否則併發請求會用到過期的記憶體物件。
      const body = await readJsonBody(req);
      const now = clock.now();
      const idempotencyKey = req.headers['idempotency-key'] || null;
      const requestHash = hashRequest({ deviceType: body.deviceType || null });

      const cached = findIdempotent(db, 'create-game', player.id, idempotencyKey);
      if (cached) {
        if (cached.request_hash !== requestHash) throw errors.idempotencyKeyReuse();
        sendJson(res, cached.status_code, JSON.parse(cached.response_json));
        return;
      }

      const inProgress = getPlayingGameForPlayer(db, player.id);
      if (inProgress) {
        const beforeEvents = inProgress.events.length;
        checkTimeout(inProgress, now);

        if (inProgress.status === 'playing') {
          throw errors.gameInProgress(toSafeGameView(inProgress));
        }

        inProgress.revision += 1;
        withTransaction(db, () => persistEvents(db, inProgress, beforeEvents, now));
      }

      const deviceType = ['touch', 'pointer'].includes(body.deviceType) ? body.deviceType : null;

      const view = withTransaction(db, () => {
        const attempt = incrementAttempt(db, player.id);
        const record = newGame(player.id, attempt, Math.random, now);
        insertGame(db, record, deviceType, now);

        const view = toSafeGameView(record);
        storeIdempotent(db, 'create-game', player.id, idempotencyKey, requestHash, 201, view, now);
        return view;
      });

      sendJson(res, 201, view);
    },
  });

  routes.push({
    method: 'GET',
    pattern: /^\/api\/games\/current$/,
    handler: (req, res) => {
      const player = requirePlayer(db, req);
      const game = getLatestGameForPlayer(db, player.id);

      if (!game) {
        res.writeHead(204).end();
        return;
      }

      const now = clock.now();
      const beforeEvents = game.events.length;

      if (game.status === 'playing' && checkTimeout(game, now)) {
        game.revision += 1;
        withTransaction(db, () => persistEvents(db, game, beforeEvents, now));
      }

      sendJson(res, 200, toSafeGameView(game));
    },
  });

  routes.push({
    method: 'POST',
    pattern: /^\/api\/games\/(?<id>[^/]+)\/actions$/,
    handler: async (req, res, params) => {
      const player = requirePlayer(db, req);
      const body = await readJsonBody(req);

      if (!body.actionId || typeof body.actionId !== 'string') {
        throw errors.badRequest('缺少 actionId');
      }
      if (!['place', 'discard', 'abandon'].includes(body.type)) {
        throw errors.badRequest('type 必須是 place、discard 或 abandon');
      }
      if (!Number.isInteger(body.expectedRevision)) {
        throw errors.badRequest('缺少 expectedRevision');
      }
      if (
        (body.type === 'place' || body.type === 'discard') &&
        !Number.isInteger(body.handIndex)
      ) {
        throw errors.badRequest('缺少 handIndex');
      }
      if (
        body.type === 'place' &&
        (!Number.isInteger(body.row) || !Number.isInteger(body.col))
      ) {
        throw errors.badRequest('place 需要 row 與 col');
      }

      // 讀 body 是這個 handler 唯一的 await。從這裡開始到回應送出都是同步執行，
      // 讀到的 game 一定是當下最新狀態，不會被併發請求用過期物件蓋掉
      // （Codex review 重現的 P1：delayed invalid action 回退已確認的 turn）。
      const game = ownedGame(getGame(db, params.id), player);

      const requestHash = hashRequest(body);
      const cached = findIdempotent(db, 'action', game.id, body.actionId);
      if (cached) {
        if (cached.request_hash !== requestHash) throw errors.idempotencyKeyReuse();
        sendJson(res, cached.status_code, JSON.parse(cached.response_json));
        return;
      }

      const now = clock.now();
      const initialEventsCount = game.events.length;

      // 每次行動先由伺服器判斷逾時，逾時一律優先結算。
      checkTimeout(game, now);
      if (game.events.length > initialEventsCount) {
        game.revision += 1;
      }

      if (body.expectedRevision !== game.revision) {
        const response = {
          error: { code: 'REVISION_CONFLICT', message: 'revision 與伺服器不一致' },
          game: toSafeGameView(game),
        };

        withTransaction(db, () => {
          persistEvents(db, game, initialEventsCount, now);
          storeIdempotent(db, 'action', game.id, body.actionId, requestHash, 409, response, now);
        });

        sendJson(res, 409, response);
        return;
      }

      const beforeAction = game.events.length;
      let success = true;

      if (body.type === 'place' || body.type === 'discard') {
        const position = body.type === 'place' ? [body.row, body.col] : null;
        success = act(game, body.handIndex, position, now);
      } else {
        abandon(game, now);
      }

      if (!success) {
        const response = { error: { code: 'INVALID_ACTION', message: '無效的行動' } };

        withTransaction(db, () => {
          persistEvents(db, game, initialEventsCount, now);
          storeIdempotent(db, 'action', game.id, body.actionId, requestHash, 422, response, now);
        });

        sendJson(res, 422, response);
        return;
      }

      if (game.events.length > beforeAction) {
        game.revision += 1;
      }

      const response = {
        game: toSafeGameView(game),
        effects: effectsSince(game.events, initialEventsCount),
      };

      withTransaction(db, () => {
        persistEvents(db, game, initialEventsCount, now);
        storeIdempotent(db, 'action', game.id, body.actionId, requestHash, 200, response, now);
      });

      sendJson(res, 200, response);
    },
  });

  routes.push({
    method: 'POST',
    pattern: /^\/api\/games\/(?<id>[^/]+)\/lifecycle$/,
    handler: async (req, res, params) => {
      const player = requirePlayer(db, req);
      const body = await readJsonBody(req);

      if (!['hidden', 'visible', 'restored'].includes(body.type)) {
        throw errors.badRequest('type 必須是 hidden、visible 或 restored');
      }

      // 同上：body 讀完才讀遊戲列，避免跟 actions 交錯時用到過期狀態。
      const game = ownedGame(getGame(db, params.id), player);

      // eventId 可省略（相容舊前端呼叫）；提供時依 actionId 的方式去重，
      // 避免重整/離線重試造成重複的 hidden/visible/restored 事件污染分析資料
      // （Codex review 的契約意見：lifecycle「重送無害」不足以支援分析）。
      const eventId = typeof body.eventId === 'string' ? body.eventId : null;
      const requestHash = hashRequest(body);

      if (eventId) {
        const cached = findIdempotent(db, 'lifecycle', game.id, eventId);
        if (cached) {
          if (cached.request_hash !== requestHash) throw errors.idempotencyKeyReuse();
          sendJson(res, cached.status_code, JSON.parse(cached.response_json));
          return;
        }
      }

      const now = clock.now();
      const initialEventsCount = game.events.length;

      checkTimeout(game, now);
      recordLifecycle(game, body.type, now);

      if (game.events.length > initialEventsCount) {
        game.revision += 1;
      }

      const response = {
        game: toSafeGameView(game),
        effects: effectsSince(game.events, initialEventsCount),
      };

      if (game.events.length > initialEventsCount || eventId) {
        withTransaction(db, () => {
          if (game.events.length > initialEventsCount) {
            persistEvents(db, game, initialEventsCount, now);
          }
          if (eventId) {
            storeIdempotent(db, 'lifecycle', game.id, eventId, requestHash, 200, response, now);
          }
        });
      }

      sendJson(res, 200, response);
    },
  });
}
