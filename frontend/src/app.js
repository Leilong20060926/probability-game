import { VERSION, CARDS, CONFIG, card, canPlace } from './engine.js';
import { api as serverApi, createGameRequest, actionRequest, lifecycleRequest, millis, publicBoard, escapeHtml } from './storage.js';
import {createTrial} from './trial.js';
import {playRockEffects,actionNotice} from './effects.js';
import {tourSteps, placeTour, scrollTourTarget} from './tour.js';

const app = document.querySelector('#app');
let player = { id: '', nextAttempt: 1 };
let game = null;
let selected = null;
let notice = '';
let help = true; // 開啟／重新整理頁面時先顯示使用教學；關閉後，再玩一局、換玩家都不會再自動跳出
let tour = 0; // 使用教學目前的步驟（tour.js 的 tourSteps 索引）
let tourTurn = 0; // 進入「選一張手牌」時的行動回合，用來判斷玩家是否完成第一個行動
let tourShown = -1; // 上次畫出的步驟，步驟改變時才捲動與移動焦點
let busy = false;
let pending = null;
let connected = false;
let serverTime = 0;
let receivedAt = 0;
let lifecycleQueue = [];
let restoredRequest = null;
let mode = null;
let trial = null;
let presentation = null;
let resultHidden = false; // 結算視窗暫時收起，讓玩家查看最後的地圖

function api(path, options) {
  if (mode === 'trial') return trial(path, options);
  if (mode === 'server') return serverApi(path, options);
  throw new Error('請先選擇是否記錄資料。');
}

function chooseMode(next) {
  if (busy || pending || game?.status === 'playing') return;
  mode = next;
  trial = next === 'trial' ? createTrial() : null;
  run(initialize);
}

// 剛選模式就連線失敗（還沒有任何一局）時，允許改選模式；其他未確認的操作仍必須先重試同步。
const modeStuck = () => !busy && !game && (pending === initialize || pending === current);

function changeMode() {
  if (busy || (pending && !modeStuck()) || game?.status === 'playing') return;
  pending = null;
  mode = null; trial = null; game = null; selected = null;
  player = {id:'',nextAttempt:1}; connected = false;
  lifecycleQueue = []; restoredRequest = null; notice = ''; help = false;
  render();
}

const modeLabel = () => mode === 'trial' ? '不記錄試玩' : mode === 'server' ? '記錄資料' : '尚未選擇紀錄模式';

function accept(view) {
  if (!view || view.id !== game?.id || view.status !== game?.status) resultHidden = false;
  game = view;
  if (view) {
    player.id = view.playerId;
    player.nextAttempt = view.attempt + 1;
    serverTime = millis(view.serverNow);
    receivedAt = performance.now();
  }
  selected = null;
}

async function current() {
  accept(await api('/api/games/current'));
}

async function run(operation) {
  if (busy) return;
  busy = true;
  pending = operation;
  notice = mode === 'trial' ? '正在準備試玩…' : '正在與伺服器同步，請稍候…';
  render();
  try {
    await operation();
    pending = null;
    connected = true;
  } catch (error) {
    selected = null;
    if (error.code === 'REVISION_CONFLICT' || error.code === 'GAME_IN_PROGRESS') {
      try {
        // Fetch fresh server time and revision, even when the error attaches a view.
        await current();
        connected = true;
        pending = null;
        notice = error.code === 'REVISION_CONFLICT'
          ? '其他操作已更新本局，已同步最新狀態，請重新選牌。'
          : '已有進行中的探勘，已恢復原局。';
      } catch {
        connected = false;
        pending = current;
        notice = '無法同步最新狀態，請重試連線。';
      }
    } else if (error.status && error.status < 500) {
      pending = current;
      connected = false;
      notice = error.status === 401
        ? '玩家憑證已失效，請重新整理以建立連線。'
        : error.message + '，請同步後重新選擇。';
    } else {
      connected = false;
      notice = '連線失敗，操作結果尚未確認。請按重試，勿關閉頁面。';
    }
  } finally {
    busy = false;
    render();
    if (connected && !pending && lifecycleQueue.length) {
      deliverLifecycle(lifecycleQueue.shift());
    }
  }
}

async function initialize() {
  const info = await api('/api/players', { body: {} });
  player = { id: info.playerId, nextAttempt: info.nextAttempt };
  await current();
  if (game?.status === 'playing') {
    const path = '/api/games/' + encodeURIComponent(game.id) + '/lifecycle';
    if (restoredRequest?.path !== path) restoredRequest = lifecycleRequest(game, 'restored');
    await api(restoredRequest.path, restoredRequest.options);
    await current();
    restoredRequest = null;
  }
  notice = mode === 'trial' ? '不記錄試玩：資料只在本頁記憶體，重整或關閉即消失。'
    : game ? '已從伺服器恢復本局，資料會繼續記錄。' : '已開啟資料紀錄，按開始探勘。';
}

function sendLifecycle(type) {
  if (game?.status !== 'playing') return;
  deliverLifecycle(lifecycleRequest(game, type));
}

function deliverLifecycle(request) {
  if (busy || pending) { lifecycleQueue.push(request); return; }
  if (game?.status !== 'playing' || request.path !== '/api/games/' + encodeURIComponent(game.id) + '/lifecycle') return;
  run(async () => {
    await api(request.path, request.options);
    await current();
    notice = mode === 'trial' ? '已回到不記錄試玩，本局不儲存。' : '已同步伺服器狀態。';
  });
}

function openTour() {
  help = true;
  tour = 0;
  tourShown = -1;
  render();
}

function goTour(index) {
  tour = Math.max(0, Math.min(index, tourSteps.length - 1));
  if (tourSteps[tour].inGame) tourTurn = game?.turn ?? 0;
}

// 操作步驟完成就自動往下；遊戲中的步驟在遊戲結束時關閉教學，讓結算視窗出現。
function syncTour() {
  while (help) {
    const step = tourSteps[tour];
    if (step.inGame && game?.status !== 'playing') { help = false; break; }
    // 改回「尚未選擇紀錄模式」時，退回選模式那一步。
    const modeStep = tourSteps.findIndex(s => s.id === 'mode');
    if (mode === null && tour > modeStep) { goTour(modeStep); continue; }
    if (step.done?.({mode, game, selected, busy, pending, tourTurn}) && tour < tourSteps.length - 1) {
      goTour(tour + 1);
      continue;
    }
    break;
  }
}

function prevTour() {
  let index = tour - 1;
  // 跳過已完成的操作步驟，否則會立刻又被自動推回來。
  while (index > 0 && tourSteps[index].done?.({mode, game, selected, busy, pending, tourTurn})) index--;
  goTour(index);
  render();
}

function positionTour() {
  if (help) placeTour(app.querySelector('.tour'), tourSteps[tour]);
}

const reasons = {
  gold: '成功找到金礦',
  timeout: '探勘時間結束',
  exhausted: '手牌與牌庫已用盡',
  abandoned: '提前結束探勘',
};

// 道路牌圖片：frontend/assets/cards/<牌的 id>.png（透明背景、正方形）。
// 圖上的通道方向必須和 engine.js CARDS 的 ports 一致。
function road(id, label = true) {
  return `
    <img
      class="road-art"
      src="./assets/cards/${id}.png"
      alt=""
      draggable="false"
    >
    ${label ? `<span>${card(id).name}</span>` : ''}
  `;
}

const remaining = () => game
  ? Math.max(0, Math.ceil((millis(game.deadlineAt) -
      (game.endedAt == null ? serverTime + performance.now() - receivedAt : millis(game.endedAt))) / 1000))
  : 300;

const playable = () => connected && !busy && !pending && (game?.status !== 'playing' || remaining() > 0);

const time = seconds => (
  `${Math.floor(seconds / 60).toString().padStart(2, '0')}:` +
  `${(seconds % 60).toString().padStart(2, '0')}`
);

function start() {
  if (!playable() || game?.status === 'playing') return;
  const request = createGameRequest(matchMedia('(pointer: coarse)').matches ? 'touch' : 'pointer');
  run(async () => {
    await api(request.path, request.options);
    await current(); // Cached idempotent responses may contain an old serverNow/revision.
    notice = '選一張手牌，亮起的格子就是可以鋪路的位置。';
  });
}

function board() {
  let cells = '';

  for (let r = 0; r < 5; r++) {
    for (let c = 0; c < 6; c++) {
      const id = presentation ? presentation.board[`${r},${c}`] : game && publicBoard(game)[`${r},${c}`];
      const rockHit = presentation?.phase === 'warning' && presentation.rock === `${r},${c}`;
      const startCell = r === 2 && c === 0;
      const target = c === 5 && [0, 2, 4].includes(r);
      const endpoint = game?.targets.find(t => t.row === r);
      const revealed = target && endpoint?.revealed;

      const legal = selected !== null &&
        game && playable() &&
        canPlace({status: game.status, board: publicBoard(game)}, game.hand[selected], r, c);

      const name = startCell
        ? '起點'
        : target
          ? (
              revealed
                ? (endpoint.reward === 'gold' ? '金礦' : '金幣')
                : '未知終點'
            )
          : id
            ? card(id).name
            : '空格';

      cells += `
        <button
          class="cell
            ${startCell ? 'entrance' : ''}
            ${target ? 'target' : ''}
            ${revealed ? 'revealed' : ''}
            ${legal ? 'legal' : ''}
            ${id ? 'occupied' : ''} ${rockHit ? 'rock-hit' : ''}"
          data-cell="${r},${c}"
          aria-label="第 ${r + 1} 列第 ${c + 1} 欄：${name}${rockHit ? '，落石即將拆除道路' : ''}${legal ? '，可放置' : ''}"
          ${!legal ? 'disabled' : ''}
        >
          ${
            startCell
              ? '<span class="mine-icon">⚒</span><small>入口</small>'
              : target
                ? `
                  ${
                    revealed
                      ? `<img class="target-art" src="./assets/targets/${endpoint.reward === 'gold' ? 'golden' : 'coin'}.png" alt="" draggable="false">`
                      : '<span class="target-symbol">?</span>'
                  }
                  <small>
                    ${revealed ? (endpoint.reward === 'gold' ? '金礦' : '金幣') : '未知礦藏'}
                  </small>
                `
                : id
                  ? road(id, false)
                  : '<span class="cell-mark">+</span>'
          }
        </button>
      `;
    }
  }

  return cells;
}

function render() {
  if (help) syncTour();
  const playing = game?.status === 'playing';

  app.innerHTML = `
    <header class="topbar">
      <a
        class="brand"
        href="/"
        aria-label="黃金探勘所首頁"
      >
        <span class="brand-mark">⚒</span>
        <span>
          黃金探勘所
          <small>THE GOLD EXPEDITION</small>
        </span>
      </a>

      <div class="header-right">
        <span class="edition">機率遊戲專題 · 單人探勘</span>
        <button class="text-button" data-action="help">
          使用教學 <span>↗</span>
        </button>
      </div>
    </header>

    <main>
      <div class="page-heading">
        <div>
          <p class="eyebrow">EXPEDITION / 001</p>
          <h1>每一條路，都藏著可能。</h1>
          <p class="subtitle">
            鋪出你的礦道，在時間用盡前找到黃金。
          </p>
        </div>

        <div class="player-chip">
          <span class="status-dot"></span>
          探勘員 ${escapeHtml(player.id.slice(0, 6).toUpperCase() || '連線中')}
          <small>
            第 ${game?.attempt || player.nextAttempt} 次探勘
          </small>
        </div>
      </div>

      <div class="game-layout">
        <section class="mine-panel" aria-label="礦坑地圖">
          <div class="panel-top">
            <div>
              <span class="eyebrow">THE MINE</span>
              <h2>礦坑地圖 <span>5 × 6</span></h2>
            </div>
            <div class="compass">N<br>↑</div>
          </div>

          <div class="board-wrap">
            <div class="column-labels">
              ${Array.from(
                { length: 6 },
                (_, i) => `<span>0${i + 1}</span>`,
              ).join('')}
            </div>

            <div class="board">${board()}</div>
          </div>

          <div class="map-footer">
            <span>
              <i class="legend-dot"></i>
              ${
                playing
                  ? '從入口開始，連接未知礦藏'
                  : '一個金礦，兩個金幣。你會先找到哪個？'
              }
            </span>
            <span>道路不可旋轉</span>
          </div>
        </section>

        <aside class="expedition-panel">
          <div class="section-label">
            EXPEDITION STATUS
            <span>
              ${playing ? '探勘中' : game ? '已結束' : '準備就緒'}
            </span>
          </div>

          <div class="timer-label">剩餘探勘時間</div>

          <div
            id="timer"
            class="timer ${remaining() < 60 ? 'urgent' : ''}"
          >
            ${time(remaining())}<span>/ 05:00</span>
          </div>

          <div class="time-track">
            <div
              id="time-bar"
              style="width:${remaining() / 3}%"
            ></div>
          </div>

          <div class="stats">
            <div>
              <span>剩餘牌庫</span>
              <strong>
                ${game?.deckRemaining ?? 17}<small> 張</small>
              </strong>
            </div>
            <div>
              <span>已得金幣</span>
              <strong>
                ${game?.coins ?? 0}<small> / 2</small>
              </strong>
            </div>
            <div>
              <span>行動回合</span>
              <strong>
                ${game?.turn ?? 0}<small> 回</small>
              </strong>
            </div>
            <div>
              <span>金礦獎勵</span>
              <strong class="gold-text">
                60<small> 分</small>
              </strong>
            </div>
          </div>

          <div class="mission-note">
            <span>◆</span>
            <div>
              <strong>黃金只留給抵達的人。</strong>
              <p>
                找到金礦得 60 分；每個金幣加 20 分。
                沒有找到金礦，最終得分為 0。
              </p>
            </div>
          </div>

          ${deckPanel()}

          <div class="expedition-actions">
            <section class="recording-panel ${playing ? 'recording-active' : ''}" aria-label="資料紀錄模式">
              <h2>${modeLabel()}</h2>
              ${mode === null ? `
                <p>開始前，請選擇是否記錄資料。</p>
                <div class="mode-options">
                  <button data-action="choose-trial">不記錄試玩</button>
                  <button data-action="choose-server">記錄資料</button>
                </div>
              ` : `
                <p>${mode === 'trial' ? '本局不儲存、不上傳；重整或關閉即消失。'
                  : '本局操作與成績會保存至後端，供統計與匯出。'}</p>
                <button data-action="change-mode" ${playing || busy || (pending && !modeStuck()) ? 'disabled' : ''}>切換紀錄模式</button>
                <p>開局後不能切換；不會刪除以前的紀錄。</p>
              `}
            </section>
          ${
            !playing
              ? `
                ${game?.status === 'finished' && resultHidden
                  ? '<button class="view-map" data-action="show-result">查看本局成績</button>'
                  : ''}
                <button class="primary" data-action="start">
                  ${game ? '再探勘一次' : '開始探勘'}
                  <span>→</span>
                </button>
              `
              : `
                <button
                  class="text-button end-button"
                  data-action="end"
                >
                  提前結束本局
                </button>
              `
          }
          </div>

          <p class="save-note" role="status">
            ${mode === 'trial' ? '◉ 不記錄試玩 · 僅本頁記憶體'
              : mode === null ? '尚未開始記錄，請先選擇紀錄模式'
              : busy ? '正在等待伺服器確認…' : connected && !pending ? '◉ 記錄資料 · 操作由伺服器確認' : '連線中斷或尚未完成同步'}
          </p>
          <p class="notice" role="status">${escapeHtml(notice)}</p>
          ${pending && !busy ? '<button data-action="retry">重試連線／同步</button>' : ''}
        </aside>
      </div>

      <section class="hand-panel ${playing ? '' : 'idle'}">
        <div class="hand-heading">
          <div>
            <p class="eyebrow">YOUR HAND</p>
            <h2>
              你的道路牌
              <span>${game?.hand.length ?? 5} 張</span>
            </h2>
          </div>
          <p>
            ${
              playing
                ? '① 選擇手牌　② 點選亮起的地圖格'
                : '每回合出一張、抽一張，無法使用的牌可以棄掉。'
            }
          </p>
        </div>

        <div class="hand-row">
          ${
            (
              game?.hand ||
              [
                'horizontal',
                'tee-up',
                'cross',
                'vertical',
                'bend-dr',
              ]
            ).map((id, i) => `
              <button
                class="hand-card ${selected === i ? 'selected' : ''}"
                data-hand="${i}"
                ${!playing ? 'disabled' : ''}
                aria-pressed="${selected === i}"
              >
                <span class="card-number">0${i + 1}</span>
                ${road(id)}
                <small>
                  ${selected === i ? '已選取 ✓' : '點選道路牌'}
                </small>
              </button>
            `).join('')
          }

          <div class="discard-area">
            <span>手牌用不上？</span>
            <button
              data-action="discard"
              ${selected === null || !playing ? 'disabled' : ''}
            >
              棄掉選取牌 ↗
            </button>
            <small>棄牌也會抽牌，可能遇到落石。</small>
          </div>
        </div>

        <p class="notice" aria-live="polite">
          ${notice || '準備好了嗎？按下「開始探勘」，計時才會開始。'}
        </p>
      </section>

      <footer>
        <span>矮人礦坑 · 單人版</span>
        <a href="/admin.html">紀錄與統計</a>
        <span>
          18 張道路牌 / 4 張落石 / 300 秒
          <span class="version">v${VERSION}</span>
        </span>
      </footer>
    </main>

    ${help ? tourView() : ''}
    ${presentation?.phase === 'alert' ? '<div class="rock-alert" role="alert">💥 抽到破壞牌</div>' : ''}
    ${
      game?.status === 'finished' && !help && !resultHidden
        ? resultDialog()
        : ''
    }
  `;

  app.querySelectorAll('[data-hand], [data-cell], [data-action="start"], [data-action="end"], [data-action="discard"], [data-action="next-player"]').forEach(el => {
    if (!playable()) el.disabled = true;
  });
  bind();
}

// 剩餘牌庫：每種牌還有幾張沒抽，以及下一張抽到落石的機率。
// 開局前顯示整副牌的組成；舊版伺服器沒有 deckCounts 時不顯示。
function deckPanel() {
  const before = !game;
  const counts = before
    ? Object.fromEntries([...CARDS.map(c => [c.id, c.count]), ['rock', CONFIG.rocks]])
    : game.deckCounts;
  if (!counts) return '';
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const rocks = counts.rock ?? 0;
  const odds = !before && total
    ? `下一張是落石：${rocks}/${total}（${(rocks / total * 100).toFixed(1)}%）`
    : before ? '開局發 5 張道路牌到手上，其餘洗入牌庫。' : '牌庫已抽完。';
  const item = (id, name, n, art) => `
    <li class="${n ? '' : 'empty'} ${id === 'rock' ? 'rock' : ''}" title="${name}：${n} 張">
      ${art}<b>${n}</b><span class="sr-only">${name} ${n} 張</span>
    </li>`;

  return `
    <section class="deck-panel" aria-label="剩餘牌庫組成">
      <div class="deck-head">
        <span>${before ? '整副牌組成' : '剩餘牌庫組成'}</span>
        <small>${total} 張</small>
      </div>
      <ul>
        ${CARDS.map(c => item(c.id, c.name, counts[c.id] ?? 0,
          `<img src="./assets/cards/${c.id}.png" alt="" draggable="false">`)).join('')}
        ${item('rock', '落石', rocks, '<i aria-hidden="true">🪨</i>')}
      </ul>
      <p>${odds}</p>
    </section>
  `;
}

function tourView() {
  const step = tourSteps[tour];
  const state = {mode, game, selected, busy, pending, tourTurn};
  const body = typeof step.body === 'function' ? step.body(state) : step.body;
  const last = tour === tourSteps.length - 1;
  const waiting = step.action && !step.done?.(state);

  return `
    <div class="tour ${step.action ? 'interactive' : ''}">
      <div class="tour-shade"></div>
      <div class="tour-rings"></div>
      <section
        class="tour-card"
        role="dialog"
        aria-modal="${step.action ? 'false' : 'true'}"
        aria-labelledby="tour-title"
        aria-describedby="tour-body"
        tabindex="-1"
      >
        <div class="tour-head">
          <p class="eyebrow">FIELD GUIDE · 探勘員手冊</p>
          <span class="tour-count">${tour + 1} / ${tourSteps.length}</span>
        </div>
        <div class="tour-progress" aria-hidden="true">
          <i style="width:${((tour + 1) / tourSteps.length) * 100}%"></i>
        </div>
        <h2 id="tour-title">${step.title}</h2>
        <p id="tour-body">${body}</p>
        ${pending && !busy ? `
          <div class="tour-problem" role="alert">
            <button data-action="retry">重試連線</button>
            ${modeStuck() && mode === 'server' ? '<button data-action="trial-instead">改用不記錄試玩</button>' : ''}
          </div>`
        : waiting ? '<p class="tour-task">👉 請操作框起來的地方，完成後會自動進入下一步。</p>' : ''}
        <div class="tour-actions">
          <button class="tour-skip" data-action="close-help">${last ? '關閉' : '跳過教學'}</button>
          <button class="tour-prev" data-action="tour-prev" ${tour === 0 ? 'disabled' : ''}>上一步</button>
          ${last
            ? '<button class="tour-next" data-action="close-help">開始挖礦 →</button>'
            : `<button class="tour-next" data-action="tour-next" ${waiting ? 'disabled' : ''}>下一步 →</button>`}
        </div>
      </section>
    </div>
  `;
}

function resultDialog() {
  const elapsed = Math.min(
    300,
    Math.max(
      0,
      Math.round(
        (millis(game.endedAt) - millis(game.startedAt)) / 1000,
      ),
    ),
  );

  return `
    <div class="overlay">
      <section
        class="dialog result"
        role="dialog"
        aria-modal="true"
        aria-labelledby="dialog-title"
        tabindex="-1"
      >
        <p class="eyebrow">EXPEDITION COMPLETE</p>

        <div class="result-gem">
          ${game.reason === 'gold' ? '◆' : '⚒'}
        </div>

        <h2 id="dialog-title">${reasons[game.reason]}</h2>

        <p class="muted">
          第 ${game.attempt} 次探勘 · 你的本局成績
        </p>

        <div class="result-score">
          ${game.score}<span>分</span>
        </div>

        <div class="result-stats">
          <div>
            <strong>${time(elapsed)}</strong>
            <span>探勘耗時</span>
          </div>
          <div>
            <strong>${game.turn}</strong>
            <span>行動回合</span>
          </div>
          <div>
            <strong>${game.coins}</strong>
            <span>找到金幣</span>
          </div>
        </div>

        <p class="save-note">${mode === 'trial' ? '不記錄試玩：本局未儲存、未上傳。' : '記錄資料：本局成績由伺服器結算並保存。'}未翻開的終點仍保持隱藏。</p>
        <p role="status">${escapeHtml(notice)}</p>
        ${pending && !busy ? '<button data-action="retry">重試連線／同步</button>' : ''}
        <button class="primary" data-action="start">
          同一位玩家，再玩一次 →
        </button>

        <button class="view-map" data-action="hide-result">
          先看地圖（可再開啟）
        </button>

        <button
          class="text-button next-player"
          data-action="next-player"
        >
          換下一位玩家
        </button>
        <button class="text-button" data-action="change-mode" ${busy || pending ? 'disabled' : ''}>切換紀錄模式</button>
      </section>
    </div>
  `;
}

function submit(type, position) {
  if (!playable() || !game || game.status !== 'playing') return;
  const request = actionRequest(game, type, selected, position);
  const before = game.board.map(cell=>({...cell}));
  let replayed = false;
  run(async () => {
    const response = await api(request.path, request.options);
    if (!replayed) {
      try {
        await playRockEffects(before,response.effects, frame => {
          presentation = frame;
          notice = frame.phase === 'alert'
            ? '💥 抽到破壞牌！'
            : frame.rock
            ? frame.phase === 'warning' ? '🪨 落石！標示位置的道路即將被拆除。' : '落石已拆除標示位置的道路。'
            : '🪨 抽到落石，場上沒有可拆道路；繼續補牌。';
          render();
        });
        replayed = true;
      } finally {presentation = null;}
    }
    await current();
    notice = actionNotice(response.effects, mode === 'trial');
  });
}
function takeAction(position) {
  if (selected !== null) submit(position ? 'place' : 'discard', position);
}

function nextPlayer() {
  if (!playable()) return;
  const oldId = player.id;
  let attempted = false;
  run(async () => {
    let info = await api('/api/players', {body:{}});
    if (!attempted || info.playerId === oldId) {
      attempted = true;
      info = await api('/api/players/switch', {body:{}});
    }
    player = {id:info.playerId, nextAttempt:info.nextAttempt};
    accept(null);
    lifecycleQueue = [];
    await current();
    notice = '已換下一位玩家。';
  });
}

function bind() {
  app.querySelectorAll('[data-hand]').forEach(el => {
    el.onclick = () => {
      selected = selected === +el.dataset.hand
        ? null
        : +el.dataset.hand;

      notice = selected === null
        ? '已取消選取。'
        : '選擇亮起的格子放置；沒有亮格時，可以換張牌或棄牌。';

      render();
    };
  });

  app.querySelectorAll('[data-cell]').forEach(el => {
    el.onclick = () => takeAction(
      el.dataset.cell.split(',').map(Number),
    );
  });

  app.querySelectorAll('[data-action]').forEach(el => {
    el.onclick = () => {
      switch (el.dataset.action) {
        case 'choose-trial': chooseMode('trial'); break;
        case 'choose-server': chooseMode('server'); break;
        case 'change-mode': changeMode(); break;
        case 'trial-instead': {
          const keepTour = help; // changeMode() 會關掉教學；從教學卡改用試玩時要讓教學繼續
          changeMode();
          help = keepTour;
          chooseMode('trial');
          break;
        }
        case 'start':
          start();
          break;

        case 'discard':
          takeAction(null);
          break;

        case 'help':
          openTour();
          break;

        case 'tour-next':
          goTour(tour + 1);
          render();
          break;

        case 'tour-prev':
          prevTour();
          break;

        case 'close-help':
          help = false;
          render();
          break;

        case 'end':
          if (
            confirm(
              '確定提前結束？本局會記為中途結束，得分 0 分。',
            )
          ) {
            submit('abandon');
          }
          break;

        case 'next-player':
          nextPlayer();
          break;
        case 'hide-result':
          resultHidden = true;
          notice = '已收起成績視窗；按「查看本局成績」可以再打開。';
          render();
          break;
        case 'show-result':
          resultHidden = false;
          render();
          break;
        case 'retry':
          if (pending) run(pending);
          break;
      }
    };
  });

  app.querySelector('.dialog')?.focus();

  if (help) {
    const changed = tourShown !== tour;
    tourShown = tour;
    if (changed && typeof innerHeight === 'number') scrollTourTarget(tourSteps[tour]);
    positionTour();
    if (changed) app.querySelector('.tour-next:not(:disabled)')?.focus?.();
  }

  if (!app.querySelector('.dialog') && selected !== null) {
    app.querySelector(
      `[data-hand="${selected}"]`,
    )?.focus();
  }
}

if (typeof window !== 'undefined') {
  // 捲動或縮放時讓框線跟著目標移動。
  window.addEventListener('scroll', positionTour, true);
  window.addEventListener('resize', positionTour);
}

document.addEventListener('visibilitychange', () => {
  if (game?.status === 'playing') sendLifecycle(document.hidden ? 'hidden' : 'visible');
});

document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && help) {
    help = false;
    render();
  } else if (event.key === 'Escape' && game?.status === 'finished' && !resultHidden) {
    resultHidden = true;
    render();
  }

  if (
    event.key === 'Tab' &&
    app.querySelector('.dialog')
  ) {
    const items = [
      ...app.querySelectorAll('.dialog button:not(:disabled)'),
    ];

    const first = items[0];
    const last = items.at(-1);

    if (!first) { event.preventDefault(); return; }

    if (
      event.shiftKey &&
      (
        document.activeElement === first ||
        document.activeElement.classList.contains('dialog')
      )
    ) {
      event.preventDefault();
      last.focus();
    } else if (
      !event.shiftKey &&
      document.activeElement === last
    ) {
      event.preventDefault();
      first.focus();
    }
  }
});

setInterval(() => {
  positionTour(); // 圖片載入、版面變化後重新對齊教學框
  if (game?.status !== 'playing') return;

  if (!remaining() && !busy && !pending) {
    run(async () => { await current(); notice = mode === 'trial' ? '試玩時間結束，本局未記錄。' : '已同步伺服器結算狀態。'; });
    return;
  }

  const timer = document.querySelector('#timer');

  if (timer) {
    timer.innerHTML = (
      `${time(remaining())}<span>/ 05:00</span>`
    );
    timer.classList.toggle(
      'urgent',
      remaining() < 60,
    );
  }

  const bar = document.querySelector('#time-bar');

  if (bar) {
    bar.style.width = `${remaining() / 3}%`;
  }
}, 250);

render();
