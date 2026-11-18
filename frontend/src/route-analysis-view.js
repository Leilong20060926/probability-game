import {makeConfig,ROUTE_VERSION} from '../../shared/route-config.js';
import {Rational} from '../../shared/rational.js';
import {escapeHtml as e} from './storage.js';

export const rationalText=q=>`${q.numerator}/${q.denominator}`;
export const rationalNumber=q=>new Rational(q.numerator,q.denominator).toNumber();
const percent=q=>new Rational(q.numerator,q.denominator).mul(100).toDecimal(2)+'%';
const fraction=q=>`<span class="exact-fraction">${e(rationalText(q))}</span><small>≈ ${e(q.decimal)}</small>`;
export function validateExact(result) {
  if(result?.source!=='exact_dp' || result.ruleset!=='route-v1' || result.version!==ROUTE_VERSION || result.configId!==makeConfig().configId)throw new Error('分析結果與正式規則版本／配置不符，請更新資料。');
  const sum=result.pmf.reduce((value,row)=>value.add(new Rational(row.prob.numerator,row.prob.denominator)),new Rational(0));
  if(!sum.eq(1))throw new Error('分析分布未正規化');
  return result;
}
function chart(result,cumulative=false) {
  const rows=cumulative?result.cdf:result.pmf;
  const x=score=>92+Number(score)*3.6,y=p=>218-p*178;
  const marks=rows.map((row,i)=>{
    const p=rationalNumber(row.prob),px=x(row.score),py=y(p);
    if(!cumulative)return `<rect x="${px-13}" y="${py}" width="26" height="${218-py}" fill="#426e5d"/><text x="${px}" y="${py-9}" text-anchor="middle">${new Rational(row.prob.numerator,row.prob.denominator).toDecimal(4)}</text>`;
    const end=x(rows[i+1]?.score??108);
    return `<line x1="${px}" x2="${end}" y1="${py}" y2="${py}" stroke="#426e5d" stroke-width="3"/><circle cx="${px}" cy="${py}" r="4" fill="#426e5d"/>${i<rows.length-1?`<circle cx="${end}" cy="${py}" r="4" fill="#f7f6f0" stroke="#426e5d"/>`:''}`;
  }).join('');
  return `<svg class="probability-chart" viewBox="0 0 520 275" role="img" aria-label="route-v1 精確${cumulative?'CDF，實心包含端點、空心不含':'PMF'}，精確分數見表格"><text x="56" y="20">${cumulative?'F(x) = P(X ≤ x)':'P(X = x)'}</text>${[0,.25,.5,.75,1].map(p=>`<line x1="56" x2="490" y1="${y(p)}" y2="${y(p)}" stroke="#d0d5c3"/><text x="46" y="${y(p)+4}" text-anchor="end">${p}</text>`).join('')}<line x1="56" x2="56" y1="30" y2="218" stroke="#243c36"/><line x1="56" x2="490" y1="218" y2="218" stroke="#243c36"/>${marks}${rows.map(row=>`<text x="${x(row.score)}" y="242" text-anchor="middle">${row.score}</text>`).join('')}<text x="270" y="267" text-anchor="middle">最終得分 X（分）</text></svg>`;
}
const scenarioNames={base:'基準',rocks4:'只改落石 5→4',forceA:'固定走 A 線',forceB:'固定走 B 線',hand4:'手牌上限 5→4',noDig:'禁止硬挖',map1BHVHV:'地圖一 B 線改 HV→HV（比較用）',noRockCap:'落石不設上限（舊規則 0.4.0）'};
export async function mountRouteAnalysis(root,{fetcher=fetch}={}) {
  let loading=false;
  async function load() {
    if(loading)return;loading=true;
    root.innerHTML='<h1>模型與機率分析</h1><p role="status">讀取分數精確計算結果…</p>';
    try{
      const read=async path=>{const response=await fetcher(path);if(!response.ok)throw new Error('無法讀取精確分析');return response.json();};
      const [file,api]=await Promise.allSettled([read('/data/route-analysis.json'),read('/api/route/analysis')]);
      const scenarios=file.status==='fulfilled'?(file.value.scenarios||[file.value]):[];
      const result=api.status==='fulfilled'?validateExact(api.value):validateExact(scenarios.find(row=>row.scenario==='base'));
      if(!scenarios.length)scenarios.push({...result,scenario:'base'});
      render(result,scenarios);
    }catch(error){root.innerHTML=`<h1>模型與機率分析</h1><p role="status">${e(error.message)}；沒有以舊版數值或模擬代替。</p><button data-analysis-retry>重新讀取</button>`;root.querySelector('[data-analysis-retry]').onclick=load;}
    finally{loading=false;}
  }
  function render(result,scenarios) {
    root.innerHTML=`<h1>三地圖路段版 · 精確機率分析</h1><p class="model-warning">來源 exact_dp：對所有抽牌分支作分數遞迴、每個決策取最佳通關率。不是大樣本估計。理論忽略 300 秒超時與提前結束；真人可自行選擇不同動作。</p>
      <p>規則 v${e(result.version)} · 配置 ${e(result.configId)} · 平手順序 mergedByPay（同付法鋪路優先）。正式地圖一 B 線為 HH→HV。</p>
      <section class="route-analysis-cards"><div><span>單張地圖平均通關率 p</span>${fraction(result.p)}</div><div><span>整局挖到金礦 P(S)</span>${fraction(result.PS)}<strong>${percent(result.PS)}</strong></div><div><span>期望得分 E[X]（分）</span>${fraction(result.E)}</div><div><span>變異數 Var(X)（分²）</span>${fraction(result.Var)}</div></section>
      <section><h2>模型假設與精確遞迴</h2><p>H4、V4、B2、X1、R5；每張圖重洗 16 張，抽到 5 張道路牌。地圖一／二／三各 1/3，獨立可重複。每張地圖終點是金礦的條件機率為 1/3、1/2、1。</p>
      <p>狀態 s＝（地圖種類、目前路段、a、手牌各類張數、牌庫各類張數）。抽到 t 的權重為 dₜ/Σd；draw(s,n)＝Σₜ[dₜ/Σd]·下一狀態價值。R 使 a+1（a 最多 ${e(result.config.maxRockCost??'∞')}） 且 n 不減，道路牌使 n−1；best(s)＝maxₐ Q(s,a)。終點價值 1，無合法動作價值 0；岔路先補完牌再取 max(A,B)。所有機率以 BigInt 有理數運算。</p>
      <div class="table-scroll"><table class="analysis-table"><thead><tr><th>地圖</th><th>精確通關率 pᵢ</th><th>期望動作數</th></tr></thead><tbody>${result.perMap.map(row=>`<tr><td>地圖${row.mapId}</td><td>${fraction(row.p)}</td><td>${row.expectedActions}</td></tr>`).join('')}</tbody></table></div><p>平均每張地圖 ${result.expectedActions.perMapAverage} 次動作，每局 ${result.expectedActions.perGame} 次；鋪路／硬挖／換牌各算一次，選岔路不算。</p></section>
      <section><h2>PMF 與右連續 CDF</h2><p>p＝(p₁+p₂+p₃)/3。P(60)＝p/3；P(80)＝p²/3；P(100)＝p³/3；P(0)＝1−(p+p²+p³)/3。每張地圖重抽並重洗，這些分支不等機率。</p>
      <div class="model-charts"><figure><figcaption>PMF：各得分的精確機率</figcaption>${chart(result)}</figure><figure><figcaption>CDF：實心包含端點，空心不含</figcaption>${chart(result,true)}</figure></div>
      <div class="table-scroll"><table class="analysis-table"><thead><tr><th>得分 x</th><th>P(X=x)</th><th>F(x)</th></tr></thead><tbody>${result.pmf.map((row,i)=>`<tr><td>${row.score}</td><td>${fraction(row.prob)}</td><td>${fraction(result.cdf[i].prob)}</td></tr>`).join('')}</tbody></table></div><label for="route-cdf-threshold">得分門檻 x：</label><input id="route-cdf-threshold" type="number" value="80"><p id="route-cdf-result" role="status"></p></section>
      <section><h2>期望、變異數與事件機率</h2><p>E[X]＝ΣxP(X=x)＝${fraction(result.E)} 分。</p><p>E[X²]＝Σx²P(X=x)＝${fraction(result.E2)} 分²。</p><p>Var(X)＝E[X²]−E[X]²＝${fraction(result.Var)} 分²。機率未捨入就代入，只有顯示小數時四捨五入。</p><p>P(S)＝P(X&gt;0)＝1−F(0)＝${fraction(result.PS)}；單張地圖 p 與整局 P(S) 不同。</p></section>
      <section><h2>只改一項參數或策略</h2><p>以下均為同一求解器的精確遞迴結果；比較情境不會改正式遊戲設定。固定 A/B 的其他付款決策仍取最佳。</p><div class="table-scroll"><table class="analysis-table"><thead><tr><th>情境</th><th>p</th><th>E[X]</th><th>Var(X)</th><th>P(S)</th></tr></thead><tbody>${scenarios.filter(row=>row.source==='exact_dp' && row.version===result.version).map(row=>`<tr><td>${e(scenarioNames[row.scenario]||row.scenario)}</td><td>${fraction(row.p)}</td><td>${fraction(row.E)}</td><td>${fraction(row.Var)}</td><td>${fraction(row.PS)}</td></tr>`).join('')}</tbody></table></div></section>
      <section><h2>抽牌分布與實測比較</h2><p>開局手牌橫向張數 H～Hypergeometric(11,4,5)，P(H=k)＝C(4,k)C(7,5−k)/C(11,5)，分子依序 21、140、210、84、7，分母 462；E[H]＝20/11。開局完全未抽中 R 的機率為 C(11,5)/C(16,5)＝77/728。</p><p>地圖種類為離散均勻；每張圖是否通關為 Bernoulli(p)。得分 X 使用一般離散 PMF，並非二項或幾何分布。紀錄頁需以 ruleset／version／configId 篩選，地圖通關率與整局成功率分開比較；超時、放棄及真人策略會使實測偏離理論。</p><p>求解狀態 ${result.stats.states} 個；模擬只作獨立驗證，不作此頁主結果。<a href="/data/route-analysis.json" download>下載全部精確結果與參數</a></p></section>`;
    const input=root.querySelector('#route-cdf-threshold');
    input.oninput=()=>{
      const x=Number(input.value);
      if(input.value==='' || !Number.isFinite(x)){root.querySelector('#route-cdf-result').textContent='請輸入有效門檻。';return;}
      const value=result.pmf.filter(row=>row.score<=x).reduce((sum,row)=>sum.add(new Rational(row.prob.numerator,row.prob.denominator)),new Rational(0));
      root.querySelector('#route-cdf-result').textContent=`F(${x}) = ${value.toString()} ≈ ${value.toDecimal(6)}`;
    };input.oninput();
  }
  return load();
}
