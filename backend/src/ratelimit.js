// 單機記憶體限流，供組員登入使用。多實例部署需改為集中式儲存（留待後續）。
const attempts = new Map();

const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 5;

export function checkRateLimit(key, now = Date.now()) {
  const record = attempts.get(key);
  if (!record) return true;

  const recent = record.filter(ts => now - ts < WINDOW_MS);
  attempts.set(key, recent);
  return recent.length < MAX_ATTEMPTS;
}

export function recordAttempt(key, now = Date.now()) {
  const record = attempts.get(key) || [];
  record.push(now);
  attempts.set(key, record);
}

export function resetRateLimit(key) {
  attempts.delete(key);
}
