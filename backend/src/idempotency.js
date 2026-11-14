import { createHash } from 'node:crypto';
import { clock } from './clock.js';

export function hashRequest(body) {
  return createHash('sha256').update(JSON.stringify(body ?? null)).digest('hex');
}

export function findIdempotent(db, scope, ownerId, key) {
  if (!key) return null;

  return db.prepare(
    'SELECT * FROM idempotency_keys WHERE scope = ? AND owner_id = ? AND key = ?',
  ).get(scope, ownerId, key) || null;
}

export function storeIdempotent(db, scope, ownerId, key, requestHash, statusCode, responseBody, now = clock.now()) {
  if (!key) return;

  db.prepare(`
    INSERT INTO idempotency_keys (scope, owner_id, key, request_hash, status_code, response_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(scope, ownerId, key, requestHash, statusCode, JSON.stringify(responseBody), now);
}
