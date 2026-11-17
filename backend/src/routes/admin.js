import { clock } from '../clock.js';
import { readJsonBody, sendJson, sendText, getQuery } from '../http.js';
import { errors } from '../errors.js';
import {
  clearAdminSession,
  deleteAdminSession,
  issueAdminSession,
  readAdminSession,
  verifyAdminCsrf,
} from '../session.js';
import { verifyPassword } from '../password.js';
import { checkRateLimit, recordAttempt, resetRateLimit } from '../ratelimit.js';
import {
  listGames, gameStats, exportGameRows, exportEventRows,
  FILTER_KEYS, GAME_CSV_COLUMNS, EVENT_CSV_COLUMNS,
} from '../admin-repo.js';
import { toCsv } from '../csv.js';

function requireAdmin(db, req) {
  const session = readAdminSession(db, req);
  if (!session) throw errors.unauthorized('請先登入組員帳號');
  return session;
}

function filtersFromQuery(query) {
  const filters = {};
  for (const key of FILTER_KEYS) {
    const value = query.get(key);
    if (value) filters[key] = value;
  }
  return filters;
}

function clientIp(req) {
  return req.socket?.remoteAddress || 'unknown';
}

export function registerAdminRoutes(routes, db) {
  routes.push({
    method: 'POST',
    pattern: /^\/api\/admin\/login$/,
    handler: async (req, res) => {
      const body = await readJsonBody(req);
      const username = typeof body.username === 'string' ? body.username : '';
      const rateLimitKey = `${clientIp(req)}:${username}`;

      if (!checkRateLimit(rateLimitKey, clock.now())) {
        throw errors.rateLimited();
      }

      const expectedUsername = process.env.ADMIN_USERNAME || '';
      const expectedHash = process.env.ADMIN_PASSWORD_HASH || '';

      const ok = username &&
        username === expectedUsername &&
        verifyPassword(typeof body.password === 'string' ? body.password : '', expectedHash);

      if (!ok) {
        recordAttempt(rateLimitKey, clock.now());
        throw errors.unauthorized('帳號或密碼錯誤');
      }

      resetRateLimit(rateLimitKey);
      const { csrfToken } = issueAdminSession(db, res, username, clock.now());
      sendJson(res, 200, { username, csrfToken });
    },
  });

  routes.push({
    method: 'POST',
    pattern: /^\/api\/admin\/logout$/,
    handler: (req, res) => {
      const session = requireAdmin(db, req);
      if (!verifyAdminCsrf(req, session)) throw errors.forbidden('CSRF token 不符');

      deleteAdminSession(db, session.id);
      clearAdminSession(res);
      sendJson(res, 200, { loggedOut: true });
    },
  });

  routes.push({
    method: 'GET',
    pattern: /^\/api\/admin\/games$/,
    handler: (req, res) => {
      const query = getQuery(req);
      const filters = filtersFromQuery(query);
      const page = Number(query.get('page')) || 1;
      const pageSize = Number(query.get('pageSize')) || 50;

      sendJson(res, 200, listGames(db, filters, page, pageSize));
    },
  });

  routes.push({
    method: 'GET',
    pattern: /^\/api\/admin\/stats$/,
    handler: (req, res) => {
      const filters = filtersFromQuery(getQuery(req));
      sendJson(res, 200, gameStats(db, filters));
    },
  });

  routes.push({
    method: 'GET',
    pattern: /^\/api\/admin\/export\.csv$/,
    handler: (req, res) => {
      const filters = filtersFromQuery(getQuery(req));
      const rows = exportGameRows(db, filters);

      const csv = toCsv(GAME_CSV_COLUMNS, rows);

      sendText(res, 200, csv, 'text/csv; charset=utf-8');
    },
  });

  routes.push({
    method: 'GET',
    pattern: /^\/api\/admin\/events\.csv$/,
    handler: (req, res) => {
      const filters = filtersFromQuery(getQuery(req));
      const rows = exportEventRows(db, filters);

      const csv = toCsv(EVENT_CSV_COLUMNS, rows);

      sendText(res, 200, csv, 'text/csv; charset=utf-8');
    },
  });
}
