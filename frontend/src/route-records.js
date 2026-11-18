import {escapeHtml as e} from './storage.js';
import {makeConfig,ROUTE_VERSION} from '../../shared/route-config.js';
import {validateExact,rationalNumber} from './route-analysis-view.js';

export const formalFilters={ruleset:'route-v1',version:ROUTE_VERSION,configId:makeConfig().configId};
export const reasons={gold:'金礦',timeout:'超時',exhausted:'耗盡',abandoned:'提前結束'};
export const matchesFormal=filters=>Object.entries(formalFilters).every(([key,value])=>filters.get(key)===value) && !filters.get('reason') && filters.get('status')!=='playing';
const value=n=>n==null?'—':Number(n).toFixed(2);
export function recordsStatsMarkup(stats,filters,model=null) {
  const maps=stats.maps||{played:0,passed:0,passRate:null,byMapId:{}};
  if(model){try{validateExact(model);}catch{model=null;}}
  let comparison='<p>不同規則與版本的紀錄保留各自的標示；精確模型請至「模型與機率分析」查看，此處不將混合紀錄直接與模型對照。</p>';
  if(matchesFormal(filters)) {
    if(model) {
      comparison=`<h2>實測與精確模型（描述性並列）</h2><p>來源 exact_dp；實測分母為已結束 ${e(stats.finished)} 局，包含超時、提前結束與玩家策略。理論忽略超時與放棄；這不是兩組條件相同的驗證。</p>
        <div class="table-scroll"><table><thead><tr><th>分數</th><th>實測局數</th><th>實測比例</th><th>精確模型</th></tr></thead><tbody>${model.pmf.map(row=>`<tr><td>${row.score}</td><td>${e(stats.byScore[row.score]??0)}</td><td>${stats.finished?value((stats.byScore[row.score]??0)/stats.finished*100)+'%':'—'}</td><td>${e(row.prob.numerator)}/${e(row.prob.denominator)} ≈ ${value(rationalNumber(row.prob)*100)}%</td></tr>`).join('')}</tbody></table></div>
        <p>理論單圖通關率 ${(rationalNumber(model.p)*100).toFixed(2)}%；理論整局金礦成功率 ${(rationalNumber(model.PS)*100).toFixed(2)}%。兩者分母不同。</p>`;
    }else comparison='<p>精確模型暫時無法取得或版本不符；下方紀錄仍來自伺服器，可重新整理再試。</p>';
  }
  return `<p>局數 ${e(stats.games)} · 玩家數 ${e(stats.players)} · 已結束 ${e(stats.finished)}</p>
    <p>找到金礦／全部局數 ${stats.goldFinishRate==null?'—':value(stats.goldFinishRate*100)+'%'} · 已結束平均分數 ${value(stats.avgScore)} · 已結束平均耗時 ${value(stats.avgDurationMs==null?null:stats.avgDurationMs/1000)} 秒</p>
    <p>結束原因：${Object.entries(stats.byReason).map(([key,n])=>`${e(reasons[key]||key)} ${e(n)}`).join(' · ')||'無'}</p>
    <p>得分分布：${Object.entries(stats.byScore).map(([score,n])=>`${e(score)} 分：${e(n)} 局`).join(' · ')||'無'}</p>
    <h2>地圖統計（不是局數）</h2><p>已結束地圖 ${e(maps.played)} 張 · 通過 ${e(maps.passed)} 張 · 通關率 ${maps.passRate==null?'—':value(maps.passRate*100)+'%'}</p><p>只計已產生 map_end 的地圖；超時或提前結束時尚未完成的地圖不列入。</p>
    <p>${Object.entries(maps.byMapId).map(([id,m])=>`地圖${e(id)}：通過 ${e(m.passed)}／${e(m.played)} 張`).join(' · ')||'尚無路段版地圖紀錄'}</p>${comparison}`;
}
