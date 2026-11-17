import {newRouteGame,routeAct,routeCheckTimeout,routePublicView} from '../../shared/route-engine.js';
import {uuid} from './uuid.js';
import {ApiError} from './storage.js';

export function createRouteTrial({now=Date.now,rng=Math.random,gameOptions={}}={}) {
  let playerId=uuid(),attempt=0,game=null;
  const replay=new Map();
  const view=()=>{
    if(!game)return null;
    if(routeCheckTimeout(game,now()))game.revision++;
    return {...routePublicView(game),revision:game.revision,serverNow:now(),mode:'trial'};
  };
  const error=(status,code,message,extra={})=>{throw new ApiError(status,{error:{code,message},...extra});};
  function remembered(key,body,operation) {
    if(!key)return operation();
    const signature=JSON.stringify(body);
    const old=replay.get(key);
    if(old){if(old.signature!==signature)error(409,'IDEMPOTENCY_KEY_REUSE','重試識別碼已被其他操作使用');return structuredClone(old.response);}
    const response=operation();replay.set(key,{signature,response:structuredClone(response)});return response;
  }
  return async function trial(path,{body={},headers={}}={}) {
    if(path==='/api/players')return {playerId,nextAttempt:attempt+1};
    if(path==='/api/players/switch'){playerId=uuid();attempt=0;game=null;replay.clear();return {playerId,nextAttempt:1};}
    if(path==='/api/games/current')return view();
    if(path==='/api/games')return remembered(headers['Idempotency-Key']?'create:'+headers['Idempotency-Key']:null,body,()=>{
      view();if(game?.status==='playing')error(409,'GAME_IN_PROGRESS','已有進行中的試玩',{game:view()});
      game=newRouteGame({...gameOptions,playerId,attempt:++attempt,now:now(),rng});game.mode='trial';game.revision=0;
      return view();
    });
    if(!game || !path.startsWith(`/api/games/${game.id}/`))error(404,'NOT_FOUND','找不到試玩');
    if(path.endsWith('/lifecycle'))return {game:view(),effects:[]};
    if(!path.endsWith('/actions'))error(404,'NOT_FOUND','未知的試玩操作');
    return remembered('action:'+body.actionId,body,()=>{
      view();if(body.expectedRevision!==game.revision)error(409,'REVISION_CONFLICT','狀態已更新',{game:view()});
      const before=game.events.length;
      const result=routeAct(game,body,now(),rng);
      if(!result.ok)error(422,result.code,result.message);
      game.revision++;
      const effects=game.events.slice(before).map(event=>{
        const out={};
        for(const key of ['type','mapIndex','mapId','pos','branch','a','card','action','pay','segment','discard','choice','reward','result','reason','score']) {
          if(event[key]!==undefined)out[key]=event[key];
        }
        return out;
      });
      return {game:view(),effects};
    });
  };
}
