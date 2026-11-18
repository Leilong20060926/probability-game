import {uuid} from './uuid.js';
export function routeCreateRequest(deviceType,nickname) {
  return {path:'/api/games',options:{body:{ruleset:'route-v1',deviceType,...(nickname!==undefined?{nickname}:{})},headers:{'Idempotency-Key':uuid()}}};
}
export function routeActionRequest(game,action) {
  return {path:`/api/games/${encodeURIComponent(game.id)}/actions`,options:{body:{...action,actionId:uuid(),expectedRevision:game.revision}}};
}
