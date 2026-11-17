// 使用教學：一步一步框出畫面上的位置，引導玩家認識規則並完成第一個行動。
// 步驟定義與定位都在這裡；狀態（目前第幾步）由 app.js 保存，因為每次 render 都會重建畫面。
//
// 每一步：
//   title / body  標題與說明（body 可以是函式，依目前狀態產生文字）
//   targets       要框起來的元素（CSS 選擇器陣列），每個符合的元素各框一個
//   action        true 表示要玩家實際操作，框起來的區域可以點，其餘畫面遮住
//   done(s)       操作步驟的完成條件；成立時自動進入下一步
//   inGame        只在遊戲進行中有意義；遊戲結束就自動關閉教學

export const tourSteps = [
  {
    title: '歡迎來到黃金探勘所',
    body: '這是一場單人探勘：從入口開始鋪設道路，在 5 分鐘內接通藏有金礦的終點。' +
      '接下來會一步一步框出畫面上的位置，最後帶你完成第一個行動。',
  },
  {
    title: '礦坑地圖',
    targets: ['.board'],
    body: '這是 5 列 × 6 欄的礦坑。你要在空格放上道路牌，讓道路從入口一路延伸到右側的終點。',
  },
  {
    title: '入口',
    targets: ['[data-cell="2,0"]'],
    body: '所有道路都必須和入口連通。入口只向右出路，所以第一張牌要放在入口右邊。',
  },
  {
    title: '三個未知終點',
    targets: ['[data-cell="0,5"]', '[data-cell="2,5"]', '[data-cell="4,5"]'],
    body: '右側三個「?」裡有一個金礦、兩個金幣，位置每局隨機。' +
      '道路接通終點才會揭曉。終點可以從左邊、上方或下方接入，終點之間的空格也可以鋪路。',
  },
  {
    title: '你的道路牌',
    targets: ['.hand-card'],
    body: '手上有 5 張道路牌。道路不能旋轉；放下的牌必須連通入口，並且和相鄰牌的接口吻合。',
  },
  {
    title: '用不上就棄牌',
    targets: ['.discard-area'],
    body: '找不到地方放時，先選取那張牌，再按「棄掉選取牌」。' +
      '出牌或棄牌都算一個行動回合，之後會補抽一張牌。',
  },
  {
    title: '牌庫與落石',
    targets: ['.deck-panel'],
    body: '這裡列出牌庫還沒抽到的每種牌各剩幾張，以及下一張是落石的機率。牌庫 17 張裡藏著 4 張落石。補牌抽到落石，會拆掉最後鋪設的道路，然後再抽一張。' +
      '如果同一回合的落石讓剛翻開的金幣終點斷線，那次翻牌和金幣會撤銷；之後的回合才斷線則保留。' +
      '牌庫抽完後，仍可以繼續使用手牌。',
  },
  {
    title: '限時 5 分鐘',
    targets: ['#timer', '.time-track'],
    body: '按下「開始探勘」才會開始計時。切換分頁或打開教學都不會暫停。' +
      '倒數結束還沒找到金礦，得 0 分。',
  },
  {
    title: '計分方式',
    targets: ['.mission-note'],
    body: '找到金礦得 60 分並立刻結束；每個金幣加 20 分，找到金幣後可以繼續挖。' +
      '沒找到金礦就是 0 分——所以在挖到金礦之前，盡量多找幾個金幣吧！',
  },
  {
    id: 'mode',
    title: '選擇紀錄模式',
    targets: ['.recording-panel'],
    action: true,
    done: s => s.mode !== null,
    body: '請在框起來的區域選一種模式：「不記錄試玩」只在本頁運作，重整或關閉就消失；' +
      '「記錄資料」的操作與成績由伺服器確認並保存。一局開始後就不能切換。',
  },
  {
    title: '開始探勘',
    targets: ['[data-action="start"]'],
    action: true,
    done: s => s.game?.status === 'playing',
    body: s => s.busy
      ? (s.mode === 'server' ? '正在連線到伺服器，請稍候…' : '正在準備，請稍候…')
      : s.pending
        ? '連不上伺服器，所以「開始探勘」還不能按。請確認後端有在執行（npm.cmd run backend），' +
          '並且是用 http://localhost:5174/ 開啟這個頁面，然後按「重試連線」。也可以先改用「不記錄試玩」。'
        : '按下「開始探勘」，計時就會開始。',
  },
  {
    title: '選一張手牌',
    targets: ['.hand-card'],
    action: true,
    inGame: true,
    done: s => s.selected !== null,
    body: '點一張道路牌選取它。選取後，地圖上可以放置的格子會亮起來。',
  },
  {
    title: '放到亮起的格子',
    targets: ['.board', '.hand-row'],
    avoid: ['.cell.legal', '[data-cell="2,0"]'],
    action: true,
    inGame: true,
    done: s => s.game?.status === 'playing' && s.game.turn > s.tourTurn,
    body: '點地圖上亮起的格子，把道路放下去。沒有亮格的話，可以換選別張牌，或按「棄掉選取牌」。',
  },
  {
    title: '你已經上手了！',
    body: '第一個行動完成。繼續鋪路，在時間內找到金礦吧！' +
      '想再看一次教學，隨時按右上角的「使用教學」。',
  },
];

const PAD = 6;
const MARGIN = 12;

function holes(step) {
  return (step.targets || [])
    .flatMap(selector => [...document.querySelectorAll(selector)])
    .map(el => el.getBoundingClientRect())
    .filter(r => r.width && r.height)
    .map(r => ({x: r.left - PAD, y: r.top - PAD, w: r.width + PAD * 2, h: r.height + PAD * 2}));
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(v, hi));

function overlap(a, b) {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

// 讓第一個目標進入畫面（目標在畫面外或被擋住時才捲動）。
// 窄螢幕的手牌區固定在畫面底部（sticky），目標不在手牌區時要扣掉它的高度。
export function scrollTourTarget(step) {
  const el = step.targets && document.querySelector(step.targets[0]);
  if (!el?.getBoundingClientRect) return;
  // 目標在可捲動的面板裡（例如右側探勘面板）被裁掉時，先捲動那個面板。
  for (let box = el.parentElement; box && box !== document.body; box = box.parentElement) {
    const style = getComputedStyle(box);
    if (!/(auto|scroll)/.test(style.overflowY) || box.scrollHeight <= box.clientHeight) continue;
    const inner = el.getBoundingClientRect();
    const outer = box.getBoundingClientRect();
    if (inner.top < outer.top) box.scrollTop -= outer.top - inner.top + 8;
    else if (inner.bottom > outer.bottom) box.scrollTop += inner.bottom - outer.bottom + 8;
  }
  const r = el.getBoundingClientRect();
  const hand = document.querySelector('.hand-panel');
  const covered = hand && !hand.contains(el) && getComputedStyle(hand).position === 'sticky';
  const bottom = innerHeight - (covered ? hand.offsetHeight : 0);
  if (r.top >= 0 && r.bottom <= bottom) return;
  const smooth = !matchMedia('(prefers-reduced-motion: reduce)').matches;
  window.scrollBy({top: r.top + r.height / 2 - bottom / 2, behavior: smooth ? 'smooth' : 'auto'});
}

// 依目前畫面位置畫出遮罩洞、外框，並把說明卡放在不擋住目標的地方。
export function placeTour(root, step) {
  if (!root?.getBoundingClientRect) return;
  const vw = document.documentElement.clientWidth;
  const vh = innerHeight;
  const rects = holes(step);

  let d = `M0 0H${vw}V${vh}H0Z`;
  for (const r of rects) d += `M${r.x} ${r.y}h${r.w}v${r.h}h${-r.w}Z`;
  root.querySelector('.tour-shade').style.clipPath = `path(evenodd, '${d}')`;
  root.querySelector('.tour-rings').innerHTML = rects.map(r =>
    `<div class="tour-ring" style="left:${r.x}px;top:${r.y}px;width:${r.w}px;height:${r.h}px"></div>`,
  ).join('');

  const card = root.querySelector('.tour-card');
  const cw = card.offsetWidth;
  const ch = card.offsetHeight;
  const maxX = Math.max(MARGIN, vw - cw - MARGIN);
  const maxY = Math.max(MARGIN, vh - ch - MARGIN);
  let pos;

  if (!rects.length) {
    pos = {x: (vw - cw) / 2, y: (vh - ch) / 2};
  } else {
    // 以第一個目標為錨點，依序嘗試下、上、右、左，最後退到畫面底部或頂部；挑擋住目標最少的位置。
    const a = rects[0];
    const cx = clamp(a.x + a.w / 2 - cw / 2, MARGIN, maxX);
    const cy = clamp(a.y + a.h / 2 - ch / 2, MARGIN, maxY);
    const options = [
      {x: cx, y: a.y + a.h + MARGIN},
      {x: cx, y: a.y - ch - MARGIN},
      {x: a.x + a.w + MARGIN, y: cy},
      {x: a.x - cw - MARGIN, y: cy},
      {x: cx, y: maxY},
      {x: cx, y: MARGIN},
    ].map(p => ({x: clamp(p.x, MARGIN, maxX), y: clamp(p.y, MARGIN, maxY)}));
    // avoid：特別不能擋住的元素（例如亮起的可放置格），權重較高。
    const avoid = (step.avoid || [])
      .flatMap(selector => [...document.querySelectorAll(selector)])
      .map(el => el.getBoundingClientRect())
      .map(r => ({x: r.left, y: r.top, w: r.width, h: r.height}));
    let best = Infinity;
    for (const p of options) {
      const box = {x: p.x, y: p.y, w: cw, h: ch};
      const cost = rects.reduce((sum, r) => sum + overlap(box, r), 0) +
        avoid.reduce((sum, r) => sum + 20 * overlap(box, r), 0);
      if (cost < best) { best = cost; pos = p; }
    }
  }

  card.style.left = `${Math.round(pos.x)}px`;
  card.style.top = `${Math.round(pos.y)}px`;
  card.style.visibility = 'visible';
}
