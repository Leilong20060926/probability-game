import { randomUUID, randomBytes } from 'node:crypto';
import { clock } from './clock.js';

const PLAYER_COOKIE = 'mine_player_session';
const ADMIN_COOKIE = 'mine_admin_session';
const ADMIN_CSRF_COOKIE = 'mine_admin_csrf';

const PLAYER_TTL_MS = 180 * 24 * 60 * 60 * 1000;
const ADMIN_TTL_MS = 8 * 60 * 60 * 1000;

// 讀取時機要晚於 server.js 的 process.loadEnvFile()，不能在模組載入時就
// 算成常數——否則 .env 的 COOKIE_SECURE 永遠不會生效（這是 Codex review 抓到的 P1）。
function isSecure() {
  return process.env.COOKIE_SECURE === 'true';
}

export function parseCookies(req) {
  const header = req.headers.cookie || '';
  const out = {};

  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const name = part.slice(0, i).trim();
    const value = part.slice(i + 1).trim();
    if (name) out[name] = decodeURIComponent(value);
  }

  return out;
}

function cookieString(name, value, { httpOnly = true, sameSite = 'Lax', maxAgeMs } = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`, 'Path=/'];
  if (httpOnly) parts.push('HttpOnly');
  parts.push(`SameSite=${sameSite}`);
  if (isSecure()) parts.push('Secure');
  if (maxAgeMs != null) parts.push(`Max-Age=${Math.floor(maxAgeMs / 1000)}`);
  return parts.join('; ');
}

function expireCookie(name, opts) {
  return cookieString(name, '', { ...opts, maxAgeMs: 0 });
}

// --- 玩家 session ---

export function issuePlayerSession(db, res, playerId, now = clock.now()) {
  const id = randomUUID();

  db.prepare(
    'INSERT INTO player_sessions (id, player_id, created_at, expires_at) VALUES (?, ?, ?, ?)',
  ).run(id, playerId, now, now + PLAYER_TTL_MS);

  appendSetCookie(res, cookieString(PLAYER_COOKIE, id, { maxAgeMs: PLAYER_TTL_MS }));
  return id;
}

export function readPlayerSession(db, req, now = clock.now()) {
  const cookies = parseCookies(req);
  const sessionId = cookies[PLAYER_COOKIE];
  if (!sessionId) return null;

  const row = db.prepare(
    'SELECT * FROM player_sessions WHERE id = ?',
  ).get(sessionId);

  if (!row || row.expires_at <= now) return null;

  const player = db.prepare('SELECT * FROM players WHERE id = ?').get(row.player_id);
  if (!player) return null;

  return { sessionId, player };
}

export function clearPlayerSession(res) {
  appendSetCookie(res, expireCookie(PLAYER_COOKIE, {}));
}

// --- 組員 session ---

export function issueAdminSession(db, res, username, now = clock.now()) {
  const id = randomUUID();
  const csrfToken = randomBytes(24).toString('hex');

  db.prepare(
    'INSERT INTO admin_sessions (id, username, csrf_token, created_at, expires_at) VALUES (?, ?, ?, ?, ?)',
  ).run(id, username, csrfToken, now, now + ADMIN_TTL_MS);

  appendSetCookie(res, cookieString(ADMIN_COOKIE, id, { sameSite: 'Strict', maxAgeMs: ADMIN_TTL_MS }));
  appendSetCookie(res, cookieString(ADMIN_CSRF_COOKIE, csrfToken, {
    httpOnly: false,
    sameSite: 'Strict',
    maxAgeMs: ADMIN_TTL_MS,
  }));

  return { sessionId: id, csrfToken };
}

export function readAdminSession(db, req, now = clock.now()) {
  const cookies = parseCookies(req);
  const sessionId = cookies[ADMIN_COOKIE];
  if (!sessionId) return null;

  const row = db.prepare('SELECT * FROM admin_sessions WHERE id = ?').get(sessionId);
  if (!row || row.expires_at <= now) return null;

  return row;
}

export function verifyAdminCsrf(req, adminSession) {
  const header = req.headers['x-csrf-token'];
  return Boolean(header) && header === adminSession.csrf_token;
}

export function deleteAdminSession(db, sessionId) {
  db.prepare('DELETE FROM admin_sessions WHERE id = ?').run(sessionId);
}

export function clearAdminSession(res) {
  appendSetCookie(res, expireCookie(ADMIN_COOKIE, { sameSite: 'Strict' }));
  appendSetCookie(res, expireCookie(ADMIN_CSRF_COOKIE, { httpOnly: false, sameSite: 'Strict' }));
}

function appendSetCookie(res, value) {
  const existing = res.getHeader('Set-Cookie');

  if (!existing) {
    res.setHeader('Set-Cookie', [value]);
  } else if (Array.isArray(existing)) {
    res.setHeader('Set-Cookie', [...existing, value]);
  } else {
    res.setHeader('Set-Cookie', [existing, value]);
  }
}
