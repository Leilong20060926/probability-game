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

function loadOwnedGame(db, req, gameId) {
  const player = requirePlayer(db, req);
  const game = getGame(db, gameId);

  if (!game || game.playerId !== player.id) {
    throw errors.notFound('找不到這場遊戲');
  }

  return { player, game };
}

// 遊戲結束後持久化：state_json、revision、events 應在同一次呼叫內一起寫入，
// 避免事件與結果分離儲存（docs/API.md「資料欄位」要求）。
function persist(db, game, fromSeqExclusive, now) {
  db.exec('BEGIN');
  try {
    insertEvents(db, game.id, game.events, fromSeqExclusive);
    saveGame(db, game, now);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function registerGameRoutes(routes, db) {
  routes.push({
    method: 'POST',
    pattern: /^\/api\/games$/,
    handler: async (req, res) => {
      const player = requirePlayer(db, req);
      const now = clock.now();
      const body = await readJsonBody(req);
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
          throw errors.gameInProgress();
        }

        inProgress.revision += 1;
        persist(db, inProgress, beforeEvents, now);
      }

      const attempt = incrementAttempt(db, player.id);
      const record = newGame(player.id, attempt, Math.random, now);
      const deviceType = ['touch', 'pointer'].includes(body.deviceType) ? body.deviceType : null;

      insertGame(db, record, deviceType, now);

      const view = toSafeGameView(record);
      storeIdempotent(db, 'create-game', player.id, idempotencyKey, requestHash, 201, view, now);

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
        persist(db, game, beforeEvents, now);
      }

      sendJson(res, 200, toSafeGameView(game));
    },
  });

  routes.push({
    method: 'POST',
    pattern: /^\/api\/games\/(?<id>[^/]+)\/actions$/,
    handler: async (req, res, params) => {
      const { game } = loadOwnedGame(db, req, params.id);
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
        persist(db, game, initialEventsCount, now);

        const response = {
          error: { code: 'REVISION_CONFLICT', message: 'revision 與伺服器不一致' },
          game: toSafeGameView(game),
        };

        storeIdempotent(db, 'action', game.id, body.actionId, requestHash, 409, response, now);
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
        persist(db, game, initialEventsCount, now);

        const response = { error: { code: 'INVALID_ACTION', message: '無效的行動' } };
        storeIdempotent(db, 'action', game.id, body.actionId, requestHash, 422, response, now);
        sendJson(res, 422, response);
        return;
      }

      if (game.events.length > beforeAction) {
        game.revision += 1;
      }

      persist(db, game, initialEventsCount, now);

      const response = {
        game: toSafeGameView(game),
        effects: effectsSince(game.events, initialEventsCount),
      };

      storeIdempotent(db, 'action', game.id, body.actionId, requestHash, 200, response, now);
      sendJson(res, 200, response);
    },
  });

  routes.push({
    method: 'POST',
    pattern: /^\/api\/games\/(?<id>[^/]+)\/lifecycle$/,
    handler: async (req, res, params) => {
      const { game } = loadOwnedGame(db, req, params.id);
      const body = await readJsonBody(req);

      if (!['hidden', 'visible', 'restored'].includes(body.type)) {
        throw errors.badRequest('type 必須是 hidden、visible 或 restored');
      }

      const now = clock.now();
      const initialEventsCount = game.events.length;

      checkTimeout(game, now);
      recordLifecycle(game, body.type, now);

      if (game.events.length > initialEventsCount) {
        game.revision += 1;
        persist(db, game, initialEventsCount, now);
      }

      sendJson(res, 200, {
        game: toSafeGameView(game),
        effects: effectsSince(game.events, initialEventsCount),
      });
    },
  });
}
