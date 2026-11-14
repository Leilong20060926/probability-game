// Transcribed reference results from user-provided Prob.pdf, pp. 5–12.
// These are rounded published model values, not outputs of the gameplay engine.
export const scores = [0,60,80,100];
export const baseline = [.3876,.2206,.2199,.1719];
export const scenarios = [
  {name:'基準 H=5、B=4、保留十字',pmf:baseline,mean:48.02,variance:1614.7,success:.6124},
  {name:'只改落石 B=5',pmf:[.5924,.1567,.1537,.0973],mean:31.42,variance:1532.9,success:.4076},
  {name:'只改策略：十字優先打出',pmf:[.3898,.2206,.2199,.1697],mean:47.80,variance:1613.8,success:.6102},
  {name:'只改手牌 H=4',pmf:[.4574,.2102,.2043,.1281],mean:41.77,variance:null,success:.543},
];

export function distribution(pmf) {
  const mean = scores.reduce((sum,x,i)=>sum+x*pmf[i],0);
  const second = scores.reduce((sum,x,i)=>sum+x*x*pmf[i],0);
  return {mean,second,variance:second-mean*mean,
    cdf:x=>scores.reduce((sum,score,i)=>sum+(score<=x ? pmf[i] : 0),0)};
}

export function choose(n,k) {
  if (!Number.isInteger(k) || k<0 || k>n) return 0;
  let result=1;
  for(let i=1;i<=k;i++) result=result*(n-i+1)/i;
  return result;
}

export const rockCountProbability = (n,r) => choose(4,r)*choose(13,n-r)/choose(17,n);
export const firstRockProbability = w => w>=1 && w<=14 ? choose(17-w,3)/choose(17,4) : 0;

function chart(cdf=false) {
  // Keep the zero-score mark inside the plot, clear of the y-axis labels.
  const x = score=>100+score*3.4;
  const yMax = cdf ? 1 : .5;
  const ticks = cdf ? [0,.25,.5,.75,1] : [0,.1,.2,.3,.4,.5];
  const y = p=>220-p/yMax*180;
  const cumulative = distribution(baseline).cdf;
  const marks = cdf ? scores.map((score,i)=>{
    const end=i===3 ? 110 : scores[i+1];
    const value=cumulative(score);
    return `<line x1="${x(score)}" x2="${x(end)}" y1="${y(value)}" y2="${y(value)}" stroke="#2d6956" stroke-width="3"/>
      <circle cx="${x(score)}" cy="${y(value)}" r="4" fill="#2d6956"/>
      ${i<3 ? `<circle cx="${x(end)}" cy="${y(value)}" r="4" fill="#fbfaf6" stroke="#2d6956"/>` : ''}
      <text x="${x(score)+6}" y="${y(value)-10}">${value.toFixed(4)}</text>`;
  }).join('') : scores.map((score,i)=>`<rect x="${x(score)-12}" y="${y(baseline[i])}" width="24" height="${220-y(baseline[i])}" fill="#2d6956"/>
    <text x="${x(score)}" y="${y(baseline[i])-10}" text-anchor="middle">${baseline[i].toFixed(4)}</text>`).join('');
  return `<svg class="probability-chart" viewBox="0 0 520 280" role="img" aria-label="PDF 基準模型 ${cdf?'右連續累積分布 CDF':'機率質量函數 PMF'}，精確列值見下表">
    ${ticks.map(p=>`<line x1="64" x2="490" y1="${y(p)}" y2="${y(p)}" stroke="#d0d5c3"/><text x="52" y="${y(p)+4}" text-anchor="end">${p}</text>`).join('')}
    <line x1="64" x2="64" y1="30" y2="220" stroke="#243c36"/><line x1="64" x2="490" y1="220" y2="220" stroke="#243c36"/>
    ${marks}${scores.map(s=>`<text x="${x(s)}" y="241" text-anchor="middle">${s}</text>`).join('')}
    <text x="277" y="267" text-anchor="middle">最終得分 X（分）</text><text x="64" y="20">${cdf?'F(x) = P(X ≤ x)':'p(x) = P(X = x)'}</text>
  </svg>`;
}

export function mountAnalysis(root) {
  const summary=distribution(baseline);
  root.innerHTML = `<h1>模型與機率分析</h1>
    <p class="model-warning">來源：Prob.pdf 第 5–12 頁（P2）。以下為文件的簡化模型與列值，不是玩家實測，也不是目前自由鋪路遊戲的通關保證。</p>
    <section><h2>1. 情境、策略與樣本空間</h2>
      <p>5×6 地圖、H=5、剩餘牌庫 D=17（13 道路＋4 落石）、金礦在三個終點等機率各 1/3。固定先中→左→右；橫段優先橫類，縱段優先縱類，保留十字，沒有能推進的牌則棄牌；彎道在模型中只棄掉。</p>
      <p>以「能推進的牌讓距離 −1、落石讓距離 +1、不合方向棄掉」簡化接口；分段完成事件 A₃ ⊂ A₂ ⊂ A₁。模型忽略實際超時（文件估計最多 18 回合×12 秒≈216 秒），真實遊戲仍有 300 秒時限與接口限制。</p>
      <p>Ω=(金礦位置 g，牌序 π)。g∈{中、左、右} 各 1/3；起手 5 張從 18 道路不放回抽取，共 C(18,5)=8,568 種實體牌組合，再混洗 13 道路與 4 落石。等機率實體牌序不代表四種最終得分等機率。</p>
      <p>X=最終得分∈{0,60,80,100} 分；成功事件 S={X≥60}。</p></section>
    <section><h2>2. 條件機率、PMF 與 CDF</h2>
      <p>文件遞迴狀態含手牌組成、牌庫組成、剩餘落石 r、距離 d；每次抽到落石的機率為 r/n，各類道路為 nᵢ/n，不放回。邊界 d=0 為完成該段、手牌與牌庫皆空為失敗。完整推進策略依第 5–6 頁；這裡展示文件計算結果，沒有把它冒稱為已重新執行完整遞迴。</p>
      <p>P(A₁)=0.6619；P(A₂|A₁)=0.9965；P(A₃|A₂)=0.7817。</p>
      <p>P(60)=⅓P(A₁)；P(80)=⅓P(A₁)P(A₂|A₁)；P(100)=⅓P(A₁)P(A₂|A₁)P(A₃|A₂)；P(0)=1−其餘三項。</p>
      <div class="model-charts"><figure><figcaption>PMF：各得分機率</figcaption>${chart()}</figure><figure><figcaption>CDF：右連續階梯，實心含端點、空心不含</figcaption>${chart(true)}</figure></div>
      <div class="table-scroll"><table class="analysis-table"><thead><tr><th>x（分）</th><th>P(X=x)</th><th>F(x)=P(X≤x)</th></tr></thead><tbody>${scores.map((s,i)=>`<tr><td>${s}</td><td>${baseline[i].toFixed(4)}</td><td>${summary.cdf(s).toFixed(4)}</td></tr>`).join('')}</tbody></table></div>
      <label for="cdf-threshold">查詢得分門檻 x（分）：</label><input id="cdf-threshold" type="number" min="-1" max="101" step="1" value="80">
      <p id="cdf-result" aria-live="polite"></p>
      <p>P(X≥60)=1−F(0)=0.6124；P(X≥80)=1−F(60)=0.3918；P(X&lt;80)=F(60)=0.6082。注意「小於 80」與「小於等於 80」不同，F(80)=0.8281。</p></section>
    <section><h2>3. 期望值與變異數</h2>
      <p>E[X]=Σxp(x)≈48.02 分；E[X²]=Σx²p(x)≈3920.52 分²；Var(X)=E[X²]−E[X]²≈1614.79 分²；SD≈40.18 分。</p>
      <p>上述由文件 PMF 四位小數重新加總，與文件報告 Var≈1614.7 的差異來自列值／運算四捨五入。平均約 48 分不代表常拿 48 分；約 38.76% 為 0 分，其餘集中 60／80／100。文件指出失敗主要集中在第一段；那是簡化模型的解釋，尚非真人資料的證據。</p></section>
    <section><h2>4. 只改一項參數／只改策略</h2>
      <div class="table-scroll"><table class="analysis-table"><thead><tr><th>情境</th><th>P(0)</th><th>P(60)</th><th>P(80)</th><th>P(100)</th><th>E[X]（分）</th><th>Var（分²）</th><th>P(S)</th></tr></thead><tbody>${scenarios.map(s=>`<tr><td>${s.name}</td>${s.pmf.map(p=>`<td>${p.toFixed(4)}</td>`).join('')}<td>${s.mean.toFixed(2)}</td><td>${s.variance??'文件未列'}</td><td>${(s.success*100).toFixed(2)}%</td></tr>`).join('')}</tbody></table></div>
      <p>表格逐項轉錄文件第 9、11 頁，不使用這些值更改正式遊戲難度。B=5 列的 PMF 總和為 1.0001，是文件四位小數的捨入差，未偷偷正規化。</p>
      <p>增加一張落石，文件通關率約 61%→41%；十字不保留的差異較小，主要影響最後一段。文件建議 H=5→4，使通關率約 61%→54%，較接近 50%；代價是可保留牌與策略選擇變少。此比較不能證明某策略全域最佳，真實鋪路仍需實測。</p></section>
    <section><h2>5. 適用分布：不放回抽樣</h2>
      <p>前 n 張落石數 R ~ Hypergeometric(17,4,n)：P(R=r)=C(4,r)C(13,n−r)/C(17,n)。抽樣機率隨牌庫更新，不能直接當固定 p=4/17 的獨立二項分布；也不適合在 N 很小、p 不小時套 Poisson。</p>
      <p>第一張落石位置 W∈{1,…,14}：P(W=w)=C(17−w,3)/C(17,4)，E[W]=18/5=3.6 張；P(W=1)=4/17≈0.2353。這是首次成功的負超幾何情境；有些教材改以「成功前失敗次數」定義變數，需相差 1。若改放回抽樣才是幾何分布，期望 4.25 張。</p>
      <p>最終得分 X 使用一般離散 PMF，非成功次數，也非等待抽牌次數，不能直接套二項或幾何分布。</p>
      <label for="rock-sample">取前幾張牌 n：</label><select id="rock-sample">${Array.from({length:18},(_,n)=>`<option ${n===5?'selected':''}>${n}</option>`).join('')}</select>
      <p id="rock-result" aria-live="polite"></p></section>
    <section><h2>6. 實測紀錄與模型驗證</h2>
      <p>切至「紀錄與統計」，可直接查看資料庫現有局數、玩家數、進行中／已結束、得分與結束原因、每局資料及兩種 CSV；按重新整理取得最新數據。不記錄試玩完全排除。</p>
      <p>附件第 11 頁建議記版本、參數、金礦位置（限後台）、得分、結束原因、每段完成回合、落石回合、十字在哪段打出。現有後端有遊戲／事件紀錄，但沒有固定策略的「段落」分類，不能假稱已能直接驗證第 1 段失敗比例或保留十字的因果效果；需另定分析標記再交 Claude Code。</p>
      <p>比較時先限制版本、source／mode 與結束狀態，分開真人與模型、正常結束與提前結束。後台只做描述性並列，不把自由鋪路結果當作同模型的配適檢定。</p>
      <p>附件第 12 頁的 200,000 局模擬為文件作者報告，這次頁面未重跑；未新增問卷或自動產生假實測資料。</p></section>`;
  const threshold=root.querySelector('#cdf-threshold');
  threshold.oninput=()=>{
    const value=Number(threshold.value);
    root.querySelector('#cdf-result').textContent = threshold.value==='' || !Number.isFinite(value)
      ? '請輸入有效得分門檻。'
      : `F(${value}) = P(X ≤ ${value}) = ${summary.cdf(value).toFixed(4)}`;
  };
  threshold.oninput();
  const sample=root.querySelector('#rock-sample');
  sample.onchange=()=>{
    const n=Number(sample.value);
    root.querySelector('#rock-result').textContent = [0,1,2,3,4].map(r=>`P(R=${r})=${rockCountProbability(n,r).toFixed(4)}`).join('；');
  };
  sample.onchange();
}
