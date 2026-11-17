import {makeConfig} from '../../shared/route-config.js';
import {RouteSolver,hintsForState,posFromObject} from '../../shared/route-analysis.js';
const solvers=new Map();
self.onmessage=({data:{id,game}})=>{
  try {
    const config=makeConfig();
    if(game.configId!==config.configId)throw new Error('此配置尚無本機提示');
    let solver=solvers.get(config.configId);
    if(!solver){solver=new RouteSolver(config);solvers.set(config.configId,solver);}
    const state={mapId:String(game.mapId),pos:posFromObject(game.position),a:game.a,
      hand:['H','V','B','X'].map(t=>game.hand[t]),deck:['H','V','B','X','R'].map(t=>game.deckCounts[t])};
    const options=hintsForState(solver,state).map(row=>({
      ...row,action:row.action.pay?{...row.action,pay:Object.fromEntries(['H','V','B','X'].map((t,i)=>[t,row.action.pay[i]]))}:row.action,
      value:row.value.toJSON(),
    }));
    self.postMessage({id,result:{gameId:game.id,revision:game.revision,configId:game.configId,source:'exact_dp',options}});
  }catch(error){self.postMessage({id,error:error.message});}
};
