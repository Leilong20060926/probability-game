import {uuid} from './uuid.js';
export function routeCreateRequest(deviceType) {
  return {path:'/api/games',options:{body:{ruleset:'route-v1',deviceType},headers:{'Idempotency-Key':uuid()}}};
}
export function routeActionRequest(game,action) {
  return {path:`/api/games/${encodeURIComponent(game.id)}/actions`,options:{body:{...action,actionId:uuid(),expectedRevision:game.revision}}};
}
