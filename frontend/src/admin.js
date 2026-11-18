import {api, escapeHtml as e} from './storage.js';
import {recordsStatsMarkup,reasons as reason} from './route-records.js';

const $ = selector => document.querySelector(selector);
let page = 1;
let total = 0;
let applied = new URLSearchParams();
let busy = false;
if (new URLSearchParams(location.search).has('embedded')) document.querySelector('#back-player').hidden = true;

async function task(operation,success='已取得伺服器回應。') {
  if (busy) return;
  busy = true;
  document.querySelectorAll('button, input, select').forEach(el => el.disabled = true);
  $('#status').textContent = '正在等待伺服器…';
  try {
    await operation();
    $('#status').textContent = success;
  } catch (error) {
    $('#status').textContent = error.userMessage || (error.status === 401 || error.status === 403
      ? '伺服器拒絕讀取資料，請確認伺服器已更新後重試。' :
      error.status ? error.message : '連線失敗，請重試；尚未確認操作結果。');
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
  const lastPage=Math.max(1,Math.ceil(total/50));
  if(page>lastPage){page=lastPage;return load();}
  $('#stats').innerHTML = recordsStatsMarkup(stats,applied);
  $('#games').innerHTML = games.games.map(g => `<tr>${[
    g.id,g.playerNickname||'匿名玩家 '+g.playerId.slice(0,8),g.attempt,[g.ruleset,g.version,g.configId].filter(Boolean).join(' / '),g.ruleset==='route-v1'?`第 ${g.mapIndex} 張`:'—',g.status === 'playing' ? '進行中' : '已結束',
    reason[g.reason] || '—',g.score,g.turns,g.durationMs == null ? '—' : (g.durationMs / 1000).toFixed(1),
  ].map(v => `<td>${e(v)}</td>`).join('')}<td class="record-operation"><button type="button" class="delete-record" data-delete-game="${e(g.id)}" aria-label="刪除遊戲 ${e(g.id)}">刪除</button></td></tr>`).join('') || '<tr><td colspan="11">尚無符合條件的紀錄。</td></tr>';
  document.querySelectorAll('[data-delete-game]').forEach(button=>button.onclick=()=>{
    if(busy)return;
    const id=button.dataset.deleteGame;
    const game=games.games.find(row=>row.id===id);
    if(!confirm(`確定永久刪除遊戲 ${id}？\n這會移除該局與相關事件，並從統計及 CSV 排除，無法復原。${game?.status==='playing'?'\n這局仍在進行，刪除後無法繼續。':''}`))return;
    return task(async()=>{
      let deleted=false;
      try{await api('/api/admin/games/'+encodeURIComponent(id),{method:'DELETE'});deleted=true;await load();}
      catch(error){
        error.userMessage=deleted?'紀錄已刪除，但畫面更新失敗；請按重新整理取得最新統計。':
          error.status===404?'伺服器尚未提供刪除功能，請重啟更新後的後端。':
          !error.status?'刪除結果尚未確認；請重新整理，若紀錄仍存在可再次刪除。':error.message;
        throw error;
      }
    },'已刪除此局，列表與統計已更新。');
  });
  $('#page-info').textContent = `第 ${games.page} 頁，共 ${total} 局（每頁 50 局）`;
}
$('#filters').onsubmit = event => {
  event.preventDefault();
  applied = new URLSearchParams([...new FormData(event.currentTarget)].filter(([key,v]) => ['configId','mode','reason'].includes(key) && v));
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
// Records are public by explicit user decision; no login or session bootstrap.
task(load);
