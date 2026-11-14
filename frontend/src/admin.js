import {api, escapeHtml as e} from './storage.js';
import {scores,baseline} from './analysis.js';

const $ = selector => document.querySelector(selector);
let csrfToken = '';
let page = 1;
let total = 0;
let applied = new URLSearchParams();
let busy = false;
const reason = {gold:'金礦',timeout:'超時',exhausted:'耗盡',abandoned:'提前結束'};
if (new URLSearchParams(location.search).has('embedded')) document.querySelector('#back-player').hidden = true;

function clearPrivate() {
  $('#authorized').hidden = true;
  $('#login').hidden = false;
  $('#stats').replaceChildren();
  $('#games').replaceChildren();
  $('#page-info').textContent = '';
  csrfToken = '';
}

async function task(operation) {
  if (busy) return;
  busy = true;
  document.querySelectorAll('button, input, select').forEach(el => el.disabled = true);
  $('#status').textContent = '正在等待伺服器…';
  try {
    await operation();
    $('#status').textContent = '已取得伺服器回應。';
  } catch (error) {
    if (error.status === 401) clearPrivate();
    $('#status').textContent = error.status === 401 ? '請登入有效組員帳號。' :
      error.status === 429 ? '登入嘗試過多，請稍後再試。' :
      error.status ? error.message : '連線失敗，請重試；尚未確認操作結果。';
  } finally {
    busy = false;
    document.querySelectorAll('button, input, select').forEach(el => el.disabled = false);
    $('#previous').disabled = page <= 1;
    $('#next').disabled = page * 50 >= total;
  }
}

async function load() {
  // Clear old results before loading so failed filters cannot show stale data.
  $('#stats').replaceChildren();
  $('#games').replaceChildren();
  const query = new URLSearchParams(applied);
  query.set('page', page);
  query.set('pageSize', 50);
  const [stats, games] = await Promise.all([
    api('/api/admin/stats?' + applied), api('/api/admin/games?' + query),
  ]);
  total = games.total;
  const value = n => n == null ? '—' : Number(n).toFixed(2);
  $('#stats').innerHTML = `<p>局數 ${e(stats.games)} · 玩家數 ${e(stats.players)} · 已結束 ${e(stats.finished)}</p>
    <p>找到金礦／全部局數 ${stats.goldFinishRate == null ? '—' : value(stats.goldFinishRate * 100) + '%'} · 已結束平均分數 ${value(stats.avgScore)} · 已結束平均耗時 ${value(stats.avgDurationMs == null ? null : stats.avgDurationMs / 1000)} 秒</p>
    <p>結束原因：${Object.entries(stats.byReason).map(([k,v]) => `${e(reason[k] || k)} ${e(v)}`).join(' · ') || '無'}</p>
    <p>得分分布：${Object.entries(stats.byScore).map(([k,v]) => `${e(k)} 分：${e(v)} 局`).join(' · ') || '無'}</p>
    <h2>實測與文件模型（描述性並列）</h2>
    <p>實測分母為本次篩選的已結束 ${e(stats.finished)} 局，包含提前結束（可用結束原因篩選分開查看）。模型採固定策略與距離簡化，假設與自由鋪路不同，差異不等於程式錯誤。</p>
    <table><thead><tr><th>得分</th><th>實測局數</th><th>實測比例</th><th>PDF 基準模型</th></tr></thead><tbody>${scores.map((score,i)=>`<tr><td>${score}</td><td>${e(stats.byScore[score]??0)}</td><td>${stats.finished ? value((stats.byScore[score]??0)/stats.finished*100)+'%' : '—'}</td><td>${(baseline[i]*100).toFixed(2)}%</td></tr>`).join('')}</tbody></table>`;
  $('#games').innerHTML = games.games.map(g => `<tr>${[
    g.id,g.playerId,g.attempt,g.status === 'playing' ? '進行中' : '已結束',
    reason[g.reason] || '—',g.score,g.turns,g.durationMs == null ? '—' : (g.durationMs / 1000).toFixed(1),
  ].map(v => `<td>${e(v)}</td>`).join('')}</tr>`).join('');
  $('#page-info').textContent = `第 ${games.page} 頁，共 ${total} 局（每頁 50 局）`;
  $('#login').hidden = true;
  $('#authorized').hidden = false;
}

$('#login').onsubmit = event => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const body = {username:form.get('username'),password:form.get('password')};
  task(async () => {
    try {
      const response = await api('/api/admin/login', {body});
      csrfToken = response.csrfToken;
      page = 1;
      await load();
    } finally { $('#login').elements.password.value = ''; }
  });
};
$('#logout').onclick = () => task(async () => {
  const cookieToken = document.cookie.split('; ').find(c => c.startsWith('mine_admin_csrf='))?.split('=')[1];
  await api('/api/admin/logout', {body:{}, headers:{'X-CSRF-Token':csrfToken || decodeURIComponent(cookieToken || '')}});
  clearPrivate();
});
$('#filters').onsubmit = event => {
  event.preventDefault();
  applied = new URLSearchParams([...new FormData(event.currentTarget)].filter(([,v]) => v));
  page = 1;
  task(load);
};
$('#previous').onclick = () => { if (page > 1) { page--; task(load); } };
$('#next').onclick = () => { if (page * 50 < total) { page++; task(load); } };
document.querySelectorAll('[data-export]').forEach(button => {
  button.onclick = () => task(async () => {
    const name = button.dataset.export;
    const blob = await api(`/api/admin/${name}.csv?${applied}`, {raw:true});
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = name === 'export' ? 'games.csv' : 'events.csv';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
});
// Restoration still requires a real server session; no frontend authorization flag.
task(load);
