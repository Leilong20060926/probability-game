// Server transport; old localStorage records remain untouched.
export class ApiError extends Error {
  constructor(status, payload) {
    super(payload?.error?.message || `伺服器回應 ${status}`);
    this.status = status;
    this.code = payload?.error?.code;
    this.game = payload?.game;
  }
}
export async function api(path, {body, headers = {}, keepalive = false, raw = false} = {}) {
  const response = await fetch(path, {
    method: body === undefined ? 'GET' : 'POST',
    credentials: 'same-origin', cache: 'no-store',
    signal: AbortSignal.timeout(15000), keepalive,
    headers: {'Content-Type':'application/json', ...headers},
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    throw new ApiError(response.status, await response.json().catch(() => null));
  }
  if (raw) return response.blob();
  return response.status === 204 ? null : response.json();
}
export function createGameRequest(deviceType) {
  return {path:'/api/games', options:{body:{deviceType}, headers:{'Idempotency-Key':crypto.randomUUID()}}};
}
export function actionRequest(game, type, handIndex, position) {
  const body = {actionId:crypto.randomUUID(), expectedRevision:game.revision, type};
  if (type !== 'abandon') body.handIndex = handIndex;
  if (type === 'place') [body.row, body.col] = position;
  return {path:`/api/games/${encodeURIComponent(game.id)}/actions`, options:{body}};
}
export function lifecycleRequest(game, type) {
  return {path:`/api/games/${encodeURIComponent(game.id)}/lifecycle`,
    options:{body:{type, eventId:crypto.randomUUID()}, keepalive:true}};
}
export const millis = value => typeof value === 'number' ? value : Date.parse(value);
export const publicBoard = view => Object.fromEntries(view.board.map(c => [`${c.row},${c.col}`, c.cardId]));
export const escapeHtml = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
