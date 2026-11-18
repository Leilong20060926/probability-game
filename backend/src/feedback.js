import { clock } from './clock.js';
import { ApiError, errors } from './errors.js';
import { getQuery, readJsonBody, sendJson } from './http.js';
import { readPlayerSession } from './session.js';

function requirePlayer(db, req) {
    const session = readPlayerSession(db, req);
    if (!session) throw errors.unauthorized('請先建立玩家身分');
    return session.player;
}

function firstFinishedGame(db, playerId) {
    return db.prepare(`
    SELECT id, ended_at, player_nickname FROM games
    WHERE player_id = ? AND mode = 'server'
      AND status = 'finished' AND ended_at IS NOT NULL
    ORDER BY ended_at, created_at, id LIMIT 1
  `).get(playerId);
}

function verifiedGame(db, playerId, gameId) {
    if (gameId == null) return null;

    if (typeof gameId !== 'string' || !gameId) {
        throw errors.badRequest('gameId 格式不正確');
    }

    const game = db.prepare(`
    SELECT mode, status, ended_at, player_nickname
    FROM games WHERE id = ? AND player_id = ?
  `).get(gameId, playerId);

    if (!game || game.mode !== 'server') {
        throw errors.notFound('找不到這場遊戲');
    }

    if (game.status !== 'finished' || game.ended_at == null) {
        throw new ApiError(
            409,
            'FEEDBACK_GAME_NOT_FINISHED',
            '請在本局結束後填寫問卷',
        );
    }

    return game;
}

function toFeedback(row) {
    if (!row) return null;

    return {
        playerId: row.player_id,
        playerNickname: row.player_nickname ?? null,
        firstGameId: row.first_game_id,
        firstGameEndedAt: row.first_game_ended_at,
        difficulty: row.difficulty,
        replay: Boolean(row.replay),
        enjoyment: row.enjoyment,
        submittedAt: row.submitted_at,
    };
}

function savedFeedback(db, playerId) {
    return toFeedback(
        db.prepare('SELECT * FROM player_feedback WHERE player_id = ?')
            .get(playerId),
    );
}

function wasDeleted(db, playerId) {
    return Boolean(
        db.prepare(
            'SELECT 1 FROM player_feedback_deletions WHERE player_id = ?'
        ).get(playerId)
    );
}

function deleteFeedback(db, playerId) {
    db.exec('BEGIN');

    try {
        const exists = db.prepare(
            'SELECT 1 FROM player_feedback WHERE player_id = ?'
        ).get(playerId);

        if (exists) {
            db.prepare(`
        INSERT OR IGNORE INTO player_feedback_deletions
          (player_id, deleted_at)
        VALUES (?, ?)
      `).run(playerId, clock.now());

            db.prepare(
                'DELETE FROM player_feedback WHERE player_id = ?'
            ).run(playerId);
        }

        db.exec('COMMIT');
        return { deleted: Boolean(exists), playerId };
    } catch (error) {
        db.exec('ROLLBACK');
        throw error;
    }
}

function feedbackStatus(db, playerId, gameId) {
    const feedback = savedFeedback(db, playerId);
    const submitted = Boolean(feedback) || wasDeleted(db, playerId);
    const first = submitted ? null : firstFinishedGame(db, playerId);
    const context = submitted ? null : verifiedGame(db, playerId, gameId);

    return {
        playerId,
        playerNickname: feedback
            ? feedback.playerNickname
            : context?.player_nickname ?? first?.player_nickname ?? null,
        required: !submitted && Boolean(first),
        submitted,
        firstFinishedGameId: feedback?.firstGameId ?? first?.id ?? null,
        feedback,
    };
}

function validateAnswers(body) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
        throw errors.badRequest('請完整填寫三個問題');
    }

    if (!['easy', 'medium', 'hard'].includes(body.difficulty)) {
        throw errors.badRequest('難度必須選擇太易、適中或太難');
    }

    if (typeof body.replay !== 'boolean') {
        throw errors.badRequest('請選擇是否願意再玩一次');
    }

    if (
        !Number.isInteger(body.enjoyment) ||
        body.enjoyment < 1 ||
        body.enjoyment > 5
    ) {
        throw errors.badRequest('好玩程度必須是 1 到 5 的整數');
    }
}

function pageNumber(value, fallback, max = Number.MAX_SAFE_INTEGER) {
    if (value === null) return fallback;

    const number = Number(value);
    if (!Number.isSafeInteger(number) || number < 1 || number > max) {
        throw errors.badRequest('分頁參數不正確');
    }
    return number;
}

export function registerFeedbackRoutes(routes, db) {
    routes.push({
        method: 'DELETE',
        pattern: /^\/api\/feedback\/responses\/(?<playerId>[^/]+)$/,
        handler: (req, res, params) => {
            sendJson(res, 200, deleteFeedback(db, params.playerId));
        },
    });
    routes.push({
        method: 'GET',
        pattern: /^\/api\/feedback$/,
        handler: (req, res) => {
            const player = requirePlayer(db, req);
            const gameId = getQuery(req).get('gameId');
            sendJson(res, 200, feedbackStatus(db, player.id, gameId));
        },
    });

    routes.push({
        method: 'POST',
        pattern: /^\/api\/feedback$/,
        handler: async (req, res) => {
            const body = await readJsonBody(req);
            const player = requirePlayer(db, req);

            if (typeof body?.playerId !== 'string' || !body.playerId) {
                throw errors.badRequest('缺少玩家 ID');
            }

            if (body.playerId !== player.id) {
                throw new ApiError(
                    409, 'PLAYER_CHANGED',
                    '玩家已切換，請重新整理後填寫問卷',
                );
            }

            if (wasDeleted(db, player.id)) {
                sendJson(res, 200, feedbackStatus(db, player.id));
                return;
            }

            validateAnswers(body);

            const existing = savedFeedback(db, player.id);
            if (existing) {
                if (
                    existing.difficulty !== body.difficulty ||
                    existing.replay !== body.replay ||
                    existing.enjoyment !== body.enjoyment
                ) {
                    throw new ApiError(
                        409, 'FEEDBACK_ALREADY_SUBMITTED',
                        '這個玩家 ID 已填寫問卷，不能重複修改',
                        { feedback: existing },
                    );
                }

                sendJson(res, 200, feedbackStatus(db, player.id));
                return;
            }

            const first = firstFinishedGame(db, player.id);
            if (!first) {
                throw new ApiError(
                    409, 'FEEDBACK_NOT_READY',
                    '請先完成第一局記錄模式遊戲',
                );
            }

            const context = verifiedGame(db, player.id, body.gameId);
            const nickname =
                context?.player_nickname ?? first.player_nickname ?? null;

            db.prepare(`
        INSERT INTO player_feedback
          (player_id, first_game_id, first_game_ended_at,
           difficulty, replay, enjoyment, submitted_at, player_nickname)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
                player.id, first.id, first.ended_at,
                body.difficulty, Number(body.replay), body.enjoyment,
                clock.now(), nickname,
            );

            sendJson(res, 201, feedbackStatus(db, player.id));
        },
    });

    routes.push({
        method: 'GET',
        pattern: /^\/api\/feedback\/responses$/,
        handler: (req, res) => {
            const query = getQuery(req);
            const page = pageNumber(query.get('page'), 1);
            const pageSize = pageNumber(query.get('pageSize'), 50, 200);
            const offset = (page - 1) * pageSize;

            if (!Number.isSafeInteger(offset)) {
                throw errors.badRequest('分頁參數不正確');
            }

            const total = db.prepare(
                'SELECT COUNT(*) AS n FROM player_feedback',
            ).get().n;

            const items = db.prepare(`
        SELECT * FROM player_feedback
        ORDER BY submitted_at DESC, player_id LIMIT ? OFFSET ?
      `).all(pageSize, offset).map(toFeedback);

            sendJson(res, 200, { items, total, page, pageSize });
        },
    });
}