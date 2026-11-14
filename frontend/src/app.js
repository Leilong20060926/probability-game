import { VERSION, card, canPlace } from './engine.js';
import { api as serverApi, createGameRequest, actionRequest, lifecycleRequest, millis, publicBoard, escapeHtml } from './storage.js';
import {createTrial} from './trial.js';
import {playRockEffects,actionNotice} from './effects.js';

const app = document.querySelector('#app');
let player = { id: '', nextAttempt: 1 };
let game = null;
let selected = null;
let notice = '';
let help = false;
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

function changeMode() {
  if (busy || pending || game?.status === 'playing') return;
  mode = null; trial = null; game = null; selected = null;
  player = {id:'',nextAttempt:1}; connected = false;
  lifecycleQueue = []; restoredRequest = null; notice = ''; help = false;
  render();
}

const modeLabel = () => mode === 'trial' ? '不記錄試玩' : mode === 'server' ? '記錄資料' : '尚未選擇紀錄模式';

function accept(view) {
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

const reasons = {
  gold: '成功找到金礦',
  timeout: '探勘時間結束',
  exhausted: '手牌與牌庫已用盡',
  abandoned: '提前結束探勘',
};

function road(id, label = true) {
  const ports = card(id)?.ports || '';

  const lines = {
    U: 'M50 50V0',
    D: 'M50 50V100',
    L: 'M50 50H0',
    R: 'M50 50H100',
  };

  return `
    <svg viewBox="0 0 100 100" aria-hidden="true">
      <rect
        x="3" y="3" width="94" height="94"
        rx="12" fill="currentColor"
      />
      ${[...ports].map(p => `
        <path d="${lines[p]}" class="tunnel-shadow"/>
        <path d="${lines[p]}" class="tunnel"/>
      `).join('')}
      <circle cx="50" cy="50" r="7" fill="#b4ad8e"/>
    </svg>
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
                  <span class="target-symbol">
                    ${revealed ? (endpoint.reward === 'gold' ? '◆' : '●') : '?'}
                  </span>
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
          遊戲規則 <span>↗</span>
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
                  : '本局操作與成績會保存至後端，供組員統計與匯出。'}</p>
                <button data-action="change-mode" ${playing || busy || pending ? 'disabled' : ''}>切換紀錄模式</button>
                <p>開局後不能切換；不會刪除以前的紀錄。</p>
              `}
            </section>
          ${
            !playing
              ? `
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

      <section class="hand-panel">
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
        <a href="/admin.html">組員登入</a>
        <span>
          18 張道路牌 / 4 張落石 / 300 秒
          <span class="version">v${VERSION}</span>
        </span>
      </footer>
    </main>

    ${help ? helpDialog() : ''}
    ${
      game?.status === 'finished' && !help
        ? resultDialog()
        : ''
    }
  `;

  app.querySelectorAll('[data-hand], [data-cell], [data-action="start"], [data-action="end"], [data-action="discard"], [data-action="next-player"]').forEach(el => {
    if (!playable()) el.disabled = true;
  });
  bind();
}

function helpDialog() {
  return `
    <div class="overlay">
      <section
        class="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="dialog-title"
        tabindex="-1"
      >
        <p class="eyebrow">FIELD GUIDE</p>
        <h2 id="dialog-title">探勘員手冊</h2>

        <ol>
          <li>
            從 5 張道路手牌中選一張，放到亮起的合法位置。
          </li>
          <li>
            道路不能旋轉，必須連通入口，與相鄰牌的接口吻合。
          </li>
          <li>
            出牌或棄牌後抽牌。抽到落石會拆掉最後鋪設的道路，
            並繼續抽牌。
          </li>
          <li>
            接通右側終點才會揭曉礦藏。
            金幣加分後繼續，找到金礦立即結束。
            若本回合落石讓新翻開的金幣終點斷線，該次翻牌與金幣會撤銷；之後其他回合才斷線則保留。
          </li>
          <li>
            限時 5 分鐘；牌庫空後仍可使用手牌。
            未找到金礦得 0 分。
          </li>
        </ol>

        <p class="muted">
          ${mode === 'trial' ? '計時開始後，切換分頁仍會計時；重整或關閉會丟棄試玩局。' : '記錄模式計時開始後，切換分頁或關閉頁面仍會計時。'}
          ${mode === 'trial' ? '不記錄試玩僅在本頁運作，重整或關閉即消失。' : '記錄模式的操作與成績由伺服器確認；斷線時請重試連線。'}
        </p>

        <button class="primary" data-action="close-help">
          了解，回到礦坑 →
        </button>
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
          notice = frame.rock
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
        case 'start':
          start();
          break;

        case 'discard':
          takeAction(null);
          break;

        case 'help':
          help = true;
          render();
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
        case 'retry':
          if (pending) run(pending);
          break;
      }
    };
  });

  app.querySelector('.dialog')?.focus();

  if (!app.querySelector('.dialog') && selected !== null) {
    app.querySelector(
      `[data-hand="${selected}"]`,
    )?.focus();
  }
}

document.addEventListener('visibilitychange', () => {
  if (game?.status === 'playing') sendLifecycle(document.hidden ? 'hidden' : 'visible');
});

document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && help) {
    help = false;
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
