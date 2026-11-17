import {api, escapeHtml as e} from './storage.js';
import {formalFilters,matchesFormal,recordsStatsMarkup,reasons as reason} from './route-records.js';

const $ = selector => document.querySelector(selector);
let page = 1;
let total = 0;
let applied = new URLSearchParams();
let busy = false;
if (new URLSearchParams(location.search).has('embedded')) document.querySelector('#back-player').hidden = true;

async function task(operation) {
  if (busy) return;
  busy = true;
  document.querySelectorAll('button, input, select').forEach(el => el.disabled = true);
  $('#status').textContent = '正在等待伺服器…';
  try {
    await operation();
    $('#status').textContent = '已取得伺服器回應。';
  } catch (error) {
    $('#status').textContent = error.status === 401 || error.status === 403
      ? '伺服器拒絕讀取資料，請確認伺服器已更新後重試。' :
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
  $('#page-info').textContent = '';
  total = 0;
  const query = new URLSearchParams(applied);
  query.set('page', page);
  query.set('pageSize', 50);
  const [stats, games] = await Promise.all([
    api('/api/admin/stats?' + applied), api('/api/admin/games?' + query),
  ]);
  total = games.total;
  let model=null;
  if(matchesFormal(applied)){try{model=await api('/api/route/analysis');}catch{/* Records remain usable when analysis is unavailable. */}}
  $('#stats').innerHTML = recordsStatsMarkup(stats,applied,model);
  $('#games').innerHTML = games.games.map(g => `<tr>${[
    g.id,g.playerId,g.attempt,[g.ruleset,g.version,g.configId].filter(Boolean).join(' / '),g.ruleset==='route-v1'?`第 ${g.mapIndex} 張`:'—',g.status === 'playing' ? '進行中' : '已結束',
    reason[g.reason] || '—',g.score,g.turns,g.durationMs == null ? '—' : (g.durationMs / 1000).toFixed(1),
  ].map(v => `<td>${e(v)}</td>`).join('')}</tr>`).join('');
  $('#page-info').textContent = `第 ${games.page} 頁，共 ${total} 局（每頁 50 局）`;
}
$('#filters').onsubmit = event => {
  event.preventDefault();
  applied = new URLSearchParams([...new FormData(event.currentTarget)].filter(([,v]) => v));
  page = 1;
  task(load);
};
$('#formal').onclick=()=>{
  const form=$('#filters');
  for(const element of form.elements)if(element.name)element.value='';
  for(const [name,value] of Object.entries(formalFilters))form.elements.namedItem(name).value=value;
  applied=new URLSearchParams(formalFilters);page=1;task(load);
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
// Records are public by explicit user decision; no login or session bootstrap.
task(load);
