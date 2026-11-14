import {
  VERSION,
  card,
  newGame,
  canPlace,
  act,
  checkTimeout,
  abandon,
  recordLifecycle,
} from './engine.js';

import {
  read,
  write,
  saveGame,
  storageAvailable,
} from './storage.js';

const app = document.querySelector('#app');

let player = read('player', null) || {
  id: crypto.randomUUID(),
  attempt: 0,
};

write('player', player);

let game = read('active', null);

if (game && game.playerId !== player.id) {
  game = null;
}

let selected = null;
let notice = '';
let help = false;

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
  ? Math.max(
      0,
      Math.ceil(
        (
          game.startedAt +
          300000 -
          (game.endedAt ?? Date.now())
        ) / 1000,
      ),
    )
  : 300;

const time = seconds => (
  `${Math.floor(seconds / 60).toString().padStart(2, '0')}:` +
  `${(seconds % 60).toString().padStart(2, '0')}`
);

function start() {
  if (game?.status === 'playing') return;

  player.attempt++;
  write('player', player);

  game = newGame(player.id, player.attempt);
  selected = null;
  notice = '選一張手牌，亮起的格子就是可以鋪路的位置。';

  game.deviceType = matchMedia('(pointer: coarse)').matches
    ? 'touch'
    : 'pointer';

  saveGame(game);
  render();
}

function board() {
  let cells = '';

  for (let r = 0; r < 5; r++) {
    for (let c = 0; c < 6; c++) {
      const id = game?.board[`${r},${c}`];
      const startCell = r === 2 && c === 0;
      const target = c === 5 && [0, 2, 4].includes(r);
      const revealed = game?.revealed.includes(r);

      const legal = selected !== null &&
        game &&
        canPlace(game, game.hand[selected], r, c);

      const name = startCell
        ? '起點'
        : target
          ? (
              revealed
                ? (r === game.goldRow ? '金礦' : '金幣')
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
            ${id ? 'occupied' : ''}"
          data-cell="${r},${c}"
          aria-label="第 ${r + 1} 列第 ${c + 1} 欄：${name}${legal ? '，可放置' : ''}"
          ${!legal ? 'disabled' : ''}
        >
          ${
            startCell
              ? '<span class="mine-icon">⚒</span><small>入口</small>'
              : target
                ? `
                  <span class="target-symbol">
                    ${revealed ? (r === game.goldRow ? '◆' : '●') : '?'}
                  </span>
                  <small>
                    ${revealed ? (r === game.goldRow ? '金礦' : '金幣') : '未知礦藏'}
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
          探勘員 ${player.id.slice(0, 6).toUpperCase()}
          <small>
            第 ${game?.attempt || player.attempt + 1} 次探勘
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
                ${game?.deck.length ?? 17}<small> 張</small>
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

          <p class="save-note" role="status">
            ${
              storageAvailable()
                ? '◉ 紀錄暫存於此瀏覽器 · 尚未連接雲端'
                : '⚠ 瀏覽器無法儲存，請勿關閉頁面'
            }
          </p>
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
          </li>
          <li>
            限時 5 分鐘；牌庫空後仍可使用手牌。
            未找到金礦得 0 分。
          </li>
        </ol>

        <p class="muted">
          計時開始後，切換分頁或關閉頁面仍會計時。
          紀錄目前僅存於此瀏覽器。
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
        (game.endedAt - game.startedAt) / 1000,
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

        <p class="save-note">
          ${
            storageAvailable()
              ? '本局紀錄已存於此瀏覽器，尚未上傳。'
              : '本局無法儲存，請保留此頁面。'
          }
        </p>

        <button class="primary" data-action="start">
          同一位玩家，再玩一次 →
        </button>

        <button
          class="text-button next-player"
          data-action="next-player"
        >
          換下一位玩家
        </button>
      </section>
    </div>
  `;
}

function takeAction(position) {
  if (selected === null || !game) return;

  const before = game.events.length;

  if (!act(game, selected, position)) {
    saveGame(game);
    render();
    return;
  }

  const rocks = game.events
    .slice(before)
    .filter(e => e.type === 'rock')
    .length;

  notice = rocks
    ? `落石！連續遇到 ${rocks} 張落石，已依序拆除最近鋪設的道路。`
    : position
      ? '道路已鋪設，選擇下一張手牌繼續探勘。'
      : '已棄牌並補牌，繼續尋找適合的道路。';

  selected = null;
  saveGame(game);
  render();
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
            abandon(game);
            saveGame(game);
            selected = null;
            render();
          }
          break;

        case 'next-player':
          player = {
            id: crypto.randomUUID(),
            attempt: 0,
          };
          write('player', player);

          game = null;
          write('active', null);
          selected = null;
          notice = '';
          render();
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
  if (game?.status !== 'playing') return;

  checkTimeout(game);

  recordLifecycle(
    game,
    document.hidden ? 'hidden' : 'visible',
  );

  saveGame(game);

  if (game.status === 'finished') {
    selected = null;
    render();
  }
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
      ...app.querySelectorAll('.dialog button'),
    ];

    const first = items[0];
    const last = items.at(-1);

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

  if (checkTimeout(game)) {
    saveGame(game);
    selected = null;
    render();
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

if (game?.status === 'playing') {
  checkTimeout(game);
  recordLifecycle(game, 'restored');
  saveGame(game);
}

render();