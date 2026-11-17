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
import {
  abandon, act, checkTimeout, newGame, recordLifecycle,
  newRouteGame, routeAct, routeCheckTimeout, routeAbandon, routeRecordLifecycle,
} from '../engine-adapter.js';
import { formalRouteConfig, hintsForGame } from '../route-analysis-service.js';
import { DEFAULT_TIE_ORDER } from '../../../shared/route-analysis.js';

const RULESETS = ['grid', 'route-v1'];

// 兩套規則共用 session、冪等、交易與並發處理，只有規則函式不同。
const ENGINES = {
  grid: {
    checkTimeout,
    abandon,
    recordLifecycle,
    lifecycleTypes: ['hidden', 'visible', 'restored'],
  },
  'route-v1': {
    checkTimeout: routeCheckTimeout,
    abandon: routeAbandon,
    recordLifecycle: routeRecordLifecycle,
    lifecycleTypes: ['hidden', 'visible', 'restored', 'hint_shown'],
  },
};

const engineFor = game => ENGINES[game.ruleset ?? 'grid'];

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

// 只驗證形狀；規則上的合法性交給引擎（非法時引擎完全不改狀態）。
function validateGridAction(body) {
  if (!['place', 'discard', 'abandon'].includes(body.type)) {
    throw errors.badRequest('type 必須是 place、discard 或 abandon');
  }
  if ((body.type === 'place' || body.type === 'discard') && !Number.isInteger(body.handIndex)) {
    throw errors.badRequest('缺少 handIndex');
  }
  if (body.type === 'place' && (!Number.isInteger(body.row) || !Number.isInteger(body.col))) {
    throw errors.badRequest('place 需要 row 與 col');
  }
}

function validateRouteAction(body) {
  if (!['pave', 'dig', 'exchange', 'choose_branch', 'abandon'].includes(body.type)) {
    throw errors.badRequest('type 必須是 pave、dig、exchange、choose_branch 或 abandon');
  }
  if ((body.type === 'pave' || body.type === 'dig')) {
    const pay = body.pay;
    if (!pay || typeof pay !== 'object' || Array.isArray(pay)) throw errors.badRequest('pave／dig 需要 pay: {H,V,B,X}');
    for (const [k, v] of Object.entries(pay)) {
      if (!['H', 'V', 'B', 'X'].includes(k)) throw errors.badRequest(`pay 不接受 ${k}（落石不能拿來付）`);
      if (!Number.isInteger(v) || v < 0) throw errors.badRequest('pay 的張數必須是非負整數');
    }
  }
  if (body.type === 'exchange' && !['H', 'V', 'B', 'X'].includes(body.discard)) {
    throw errors.badRequest('exchange 需要 discard: H、V、B 或 X');
  }
  if (body.type === 'choose_branch' && !['A', 'B'].includes(body.branch)) {
    throw errors.badRequest('choose_branch 需要 branch: A 或 B');
  }
}

function runRouteAction(game, body, now) {
  const action = { type: body.type };
  if (body.type === 'pave' || body.type === 'dig') action.pay = body.pay;
  if (body.type === 'exchange') action.discard = body.discard;
  if (body.type === 'choose_branch') action.branch = body.branch;
  return routeAct(game, action, now, Math.random);
}

function runGridAction(game, body, now) {
  if (body.type === 'abandon') {
    abandon(game, now);
    return { ok: true };
  }
  const position = body.type === 'place' ? [body.row, body.col] : null;
  return act(game, body.handIndex, position, now) ? { ok: true } : { ok: false, message: '無效的行動' };
}

export function registerGameRoutes(routes, db) {
  routes.push({
    method: 'POST',
    pattern: /^\/api\/games$/,
    handler: async (req, res) => {
      const player = requirePlayer(db, req);
      // 先把 body 讀完，再去讀會被併發行動影響的遊戲列；讀取與處理之間不能有 await。
      const body = await readJsonBody(req);
      const now = clock.now();
      const ruleset = body.ruleset ?? 'grid';
      if (!RULESETS.includes(ruleset)) throw errors.badRequest('ruleset 必須是 grid 或 route-v1');

      // 正式玩家不能用 payload 改牌庫或分數：設定由伺服器選，雜湊包含伺服器選定的 configId。
      const config = ruleset === 'route-v1' ? formalRouteConfig() : null;
      const idempotencyKey = req.headers['idempotency-key'] || null;
      const requestHash = hashRequest({
        deviceType: body.deviceType || null,
        ruleset,
        configId: config?.configId ?? null,
      });

      const cached = findIdempotent(db, 'create-game', player.id, idempotencyKey);
      if (cached) {
        if (cached.request_hash !== requestHash) throw errors.idempotencyKeyReuse();
        sendJson(res, cached.status_code, JSON.parse(cached.response_json));
        return;
      }

      const inProgress = getPlayingGameForPlayer(db, player.id);
      if (inProgress) {
        const beforeEvents = inProgress.events.length;
        engineFor(inProgress).checkTimeout(inProgress, now);

        if (inProgress.status === 'playing') {
          throw errors.gameInProgress(toSafeGameView(inProgress));
        }

        inProgress.revision += 1;
        withTransaction(db, () => persistEvents(db, inProgress, beforeEvents, now));
      }

      const deviceType = ['touch', 'pointer'].includes(body.deviceType) ? body.deviceType : null;

      const view = withTransaction(db, () => {
        const attempt = incrementAttempt(db, player.id);
        const record = ruleset === 'route-v1'
          ? newRouteGame({ playerId: player.id, attempt, rng: Math.random, now, config })
          : newGame(player.id, attempt, Math.random, now);
        insertGame(db, record, deviceType, now);
        insertEvents(db, record.id, record.events, 0);

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

      if (game.status === 'playing' && engineFor(game).checkTimeout(game, now)) {
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
      if (!Number.isInteger(body.expectedRevision)) {
        throw errors.badRequest('缺少 expectedRevision');
      }

      // 讀 body 是這個 handler 唯一的 await。從這裡開始到回應送出都是同步執行，
      // 讀到的 game 一定是當下最新狀態，不會被併發請求用過期物件蓋掉
      // （Codex review 重現的 P1：delayed invalid action 回退已確認的 turn）。
      const game = ownedGame(getGame(db, params.id), player);
      const route = game.ruleset === 'route-v1';
      if (route) validateRouteAction(body); else validateGridAction(body);

      // 截止前已確認的 actionId 在截止後重送：這是查詢已完成的結果，重放原回應，
      // 不能當成新的到期行動改判或重執行。
      const requestHash = hashRequest(body);
      const cached = findIdempotent(db, 'action', game.id, body.actionId);
      if (cached) {
        if (cached.request_hash !== requestHash) throw errors.idempotencyKeyReuse();
        sendJson(res, cached.status_code, JSON.parse(cached.response_json));
        return;
      }

      const now = clock.now();
      const initialEventsCount = game.events.length;

      // 每次新行動先由伺服器以單一時間點判斷逾時；到期一律先結算 timeout，
      // 之後 revision 已變，這個行動會得到 409 與最新（已結束）狀態，不付款、不抽牌、不翻終點。
      engineFor(game).checkTimeout(game, now);
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
      const result = route ? runRouteAction(game, body, now) : runGridAction(game, body, now);

      if (!result.ok) {
        const response = { error: { code: 'INVALID_ACTION', message: result.message || '無效的行動' } };

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

      // 同上：body 讀完才讀遊戲列，避免跟 actions 交錯時用到過期狀態。
      const game = ownedGame(getGame(db, params.id), player);
      const engine = engineFor(game);

      if (!engine.lifecycleTypes.includes(body.type)) {
        throw errors.badRequest(`type 必須是 ${engine.lifecycleTypes.join('、')}`);
      }

      // eventId 可省略（相容舊前端呼叫）；提供時依 actionId 的方式去重。
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

      engine.checkTimeout(game, now);
      engine.recordLifecycle(game, body.type, now);

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

  // 唯讀提示：不增加動作數、不改 revision、不暫停時間。只有已到期時才會像
  // GET current 一樣把 timeout 結算寫入（那是既有規則，不是提示造成的變更）。
  routes.push({
    method: 'GET',
    pattern: /^\/api\/games\/(?<id>[^/]+)\/hints$/,
    handler: (req, res, params) => {
      const player = requirePlayer(db, req);
      const game = ownedGame(getGame(db, params.id), player);
      if (game.ruleset !== 'route-v1') throw errors.badRequest('只有 route-v1 遊戲提供提示');

      const now = clock.now();
      const beforeEvents = game.events.length;
      if (game.status === 'playing' && routeCheckTimeout(game, now)) {
        game.revision += 1;
        withTransaction(db, () => persistEvents(db, game, beforeEvents, now));
      }

      const base = {
        gameId: game.id,
        revision: game.revision,
        ruleset: game.ruleset,
        version: game.version,
        configId: game.configId,
        status: game.status,
        mapIndex: game.mapIndex,
        mapId: game.mapId,
        pos: game.pos,
        a: game.a,
        source: 'exact_dp',
        tieOrder: DEFAULT_TIE_ORDER,
        semantics: '做完這個動作後、其餘採最佳策略時，這一張地圖的通關率；不含時間，不是整局金礦機率。',
        ignores: ['timeout', 'abandon'],
      };

      if (game.status !== 'playing') {
        sendJson(res, 200, { ...base, options: [] });
        return;
      }

      const options = hintsForGame(game);
      if (!options) {
        sendJson(res, 503, { error: { code: 'ANALYSIS_NOT_READY', message: '這個設定的精確分析尚未準備好' } });
        return;
      }

      sendJson(res, 200, { ...base, options });
    },
  });
}
