// 精確分析：記憶化狀態遞迴（MDP 逆向歸納），所有機率以 BigInt 有理數計算。
// 期望動作數依同一最佳策略與固定平手規則遞迴，用浮點數（規格允許 ±0.01）。

import { Rational, ZERO, ONE } from './rational.js';
import { SEGMENTS, ROUTE_VERSION, RULESET } from './route-config.js';

const H = 0, V = 1, B = 2, X = 3, R = 4;
// mergedByPay 是預設：只有它重現規格的參考動作數（地圖三 3.6589；paveThenDig 會得到 3.7063）。
export const TIE_ORDERS = ['mergedByPay', 'paveThenDig'];
export const DEFAULT_TIE_ORDER = 'mergedByPay';

// 位置編碼：F=第一段、K=岔路、A0..、B0..、E=終點
function posNeed(config, mapId, pos) {
  const map = config.maps[mapId];
  if (pos === 'F') return SEGMENTS[map.first];
  return SEGMENTS[map[pos[0]][Number(pos.slice(1))]];
}

function posNext(config, mapId, pos) {
  if (pos === 'F') return 'K';
  const line = config.maps[mapId][pos[0]];
  const i = Number(pos.slice(1)) + 1;
  return i < line.length ? `${pos[0]}${i}` : 'E';
}

export function posToObject(pos) {
  if (pos === 'F') return { kind: 'first', index: 0 };
  if (pos === 'K') return { kind: 'fork', index: 0 };
  if (pos === 'E') return { kind: 'end', index: 0 };
  return { kind: pos[0], index: Number(pos.slice(1)) };
}

export function posFromObject(pos) {
  if (pos.kind === 'first') return 'F';
  if (pos.kind === 'fork') return 'K';
  if (pos.kind === 'end') return 'E';
  return `${pos.kind}${pos.index}`;
}

function sum(arr) { let s = 0; for (const x of arr) s += x; return s; }

// 依 pay=(H,V,B,X) 字典序列舉總張數為 k 且不超過手牌的付法
function* paysOfSize(hand, k) {
  for (let h = 0; h <= Math.min(hand[H], k); h++) {
    for (let v = 0; v <= Math.min(hand[V], k - h); v++) {
      for (let b = 0; b <= Math.min(hand[B], k - h - v); b++) {
        const x = k - h - v - b;
        if (x <= hand[X]) yield [h, v, b, x];
      }
    }
  }
}

export function canPave(need, a, pay) {
  if (sum(pay) !== need.H + need.V + need.B + a) return false;
  const gap = Math.max(0, need.H - pay[H]) + Math.max(0, need.V - pay[V]) + Math.max(0, need.B - pay[B]);
  return gap <= pay[X];
}

// 固定順序列出目前路段的所有合法動作（不含岔路選擇）。
export function legalActions(config, mapId, pos, a, hand, deck, tieOrder = DEFAULT_TIE_ORDER) {
  const need = posNeed(config, mapId, pos);
  const paveSize = need.H + need.V + need.B + a;
  const digSize = config.digBase + a;
  const paves = [];
  for (const pay of paysOfSize(hand, paveSize)) {
    if (canPave(need, a, pay)) paves.push({ type: 'pave', pay });
  }
  const digs = [];
  if (config.allowDig) {
    for (const pay of paysOfSize(hand, digSize)) digs.push({ type: 'dig', pay });
  }

  let payActions;
  if (tieOrder === 'paveThenDig') {
    payActions = [...paves, ...digs];
  } else {
    // 鋪路與硬挖合併後依 pay 字典序；同 pay 時鋪路在前。
    payActions = [...paves, ...digs].sort((p, q) => {
      for (let i = 0; i < 4; i++) if (p.pay[i] !== q.pay[i]) return p.pay[i] - q.pay[i];
      return p.type === q.type ? 0 : p.type === 'pave' ? -1 : 1;
    });
  }

  const exchanges = [];
  if (sum(deck) > 0) {
    for (const t of [H, V, B, X]) {
      if (hand[t] > 0) exchanges.push({ type: 'exchange', discard: 'HVBX'[t] });
    }
  }
  return [...payActions, ...exchanges];
}

export class RouteSolver {
  constructor(config, { tieOrder = DEFAULT_TIE_ORDER } = {}) {
    if (!TIE_ORDERS.includes(tieOrder)) throw new Error(`unknown tieOrder ${tieOrder}`);
    this.config = config;
    this.tieOrder = tieOrder;
    this.memoBest = new Map();
    this.memoDraw = new Map();
    this.hits = 0;
    this.misses = 0;
  }

  get stateCount() { return this.memoBest.size + this.memoDraw.size; }

  draw(mapId, pos, a, hand, deck, n) {
    const total = sum(deck);
    if (n === 0 || total === 0) return this.best(mapId, pos, a, hand, deck);
    const key = `${mapId}|${pos}|${a}|${hand}|${deck}|${n}`;
    const cached = this.memoDraw.get(key);
    if (cached) { this.hits++; return cached; }
    this.misses++;

    let value = ZERO;
    let actions = 0;
    for (let t = 0; t < 5; t++) {
      if (!deck[t]) continue;
      const w = new Rational(BigInt(deck[t]), BigInt(total));
      const d2 = deck.slice(); d2[t]--;
      let child;
      if (t === R) {
        child = this.draw(mapId, pos, a + 1, hand, d2, n);
      } else {
        const h2 = hand.slice(); h2[t]++;
        child = this.draw(mapId, pos, a, h2, d2, n - 1);
      }
      value = value.add(w.mul(child.value));
      actions += (deck[t] / total) * child.actions;
    }
    const result = { value, actions };
    this.memoDraw.set(key, result);
    return result;
  }

  best(mapId, pos, a, hand, deck) {
    if (pos === 'E') return { value: ONE, actions: 0, choice: null };
    const key = `${mapId}|${pos}|${a}|${hand}|${deck}`;
    const cached = this.memoBest.get(key);
    if (cached) { this.hits++; return cached; }
    this.misses++;

    let result;
    if (pos === 'K') {
      const branches = this.config.forceBranch ? [this.config.forceBranch] : ['A', 'B'];
      let chosen = null;
      for (const br of branches) {
        const r = this.best(mapId, `${br}0`, a, hand, deck);
        // 岔路平手選 A：只有嚴格大於才替換
        if (!chosen || r.value.gt(chosen.r.value)) chosen = { br, r };
      }
      result = { value: chosen.r.value, actions: chosen.r.actions, choice: { type: 'choose_branch', branch: chosen.br } };
    } else {
      const options = this.actionResults(mapId, pos, a, hand, deck);
      let chosen = null;
      for (const o of options) {
        if (!chosen || o.value.gt(chosen.value)) chosen = o;
      }
      result = chosen
        ? { value: chosen.value, actions: chosen.actions, choice: chosen.action }
        : { value: ZERO, actions: 0, choice: null };
    }
    this.memoBest.set(key, result);
    return result;
  }

  // 每個合法動作的 Q 值（做完後其餘採最佳策略的本張地圖通關率）與期望動作數（含這一步）
  actionResults(mapId, pos, a, hand, deck) {
    const results = [];
    for (const action of legalActions(this.config, mapId, pos, a, hand, deck, this.tieOrder)) {
      let child;
      if (action.type === 'exchange') {
        const t = 'HVBX'.indexOf(action.discard);
        const h2 = hand.slice(); h2[t]--;
        child = this.draw(mapId, pos, a, h2, deck, 1);
      } else {
        const h2 = hand.map((c, i) => c - action.pay[i]);
        const next = posNext(this.config, mapId, pos);
        child = next === 'E'
          ? { value: ONE, actions: 0 }
          : this.draw(mapId, next, 0, h2, deck, this.config.handLimit - sum(h2));
      }
      results.push({ action, value: child.value, actions: 1 + child.actions });
    }
    return results;
  }

  mapStart(mapId) {
    const d = this.config.deck;
    return this.draw(mapId, 'F', 0, [0, 0, 0, 0], [d.H, d.V, d.B, d.X, d.R], this.config.handLimit);
  }
}

// 給定玩家目前（安全、公開）狀態，列出每個合法動作的 Q 值與最佳標記。
export function hintsForState(solver, { mapId, pos, a, hand, deck }) {
  if (pos === 'K') {
    const branches = solver.config.forceBranch ? [solver.config.forceBranch] : ['A', 'B'];
    const rows = branches.map(br => ({
      action: { type: 'choose_branch', branch: br },
      ...solver.best(mapId, `${br}0`, a, hand, deck),
    }));
    return markBest(rows);
  }
  return markBest(solver.actionResults(mapId, pos, a, hand, deck));
}

function markBest(rows) {
  let bestIndex = -1;
  rows.forEach((row, i) => {
    if (bestIndex < 0 || row.value.gt(rows[bestIndex].value)) bestIndex = i;
  });
  return rows.map((row, i) => ({
    action: row.action,
    value: row.value,
    expectedActions: row.actions,
    tieRank: i,
    best: i === bestIndex,
  }));
}

// 開局發牌（抽到 handLimit 張道路牌，落石移出）的精確分布：鍵 "H,V,B,X|落石數"。
// 直接模擬發牌過程，不套超幾何公式，用來交叉檢查規格 D 的超幾何數值。
export function initialDealDistribution(config) {
  const d = config.deck;
  let frontier = new Map([[`0,0,0,0|${d.H},${d.V},${d.B},${d.X},${d.R}|0`, ONE]]);
  const done = new Map();
  while (frontier.size) {
    const next = new Map();
    for (const [key, prob] of frontier) {
      const [h, k, r] = key.split('|');
      const hand = h.split(',').map(Number);
      const deck = k.split(',').map(Number);
      const rocks = Number(r);
      const total = sum(deck);
      if (sum(hand) === config.handLimit || total === 0) {
        const out = `${hand}|${rocks}`;
        done.set(out, (done.get(out) || ZERO).add(prob));
        continue;
      }
      for (let t = 0; t < 5; t++) {
        if (!deck[t]) continue;
        const p = prob.mul(new Rational(BigInt(deck[t]), BigInt(total)));
        const d2 = deck.slice(); d2[t]--;
        const h2 = hand.slice();
        if (t !== R) h2[t]++;
        const nk = `${h2}|${d2}|${rocks + (t === R ? 1 : 0)}`;
        next.set(nk, (next.get(nk) || ZERO).add(p));
      }
    }
    frontier = next;
  }
  return done;
}

// p=(p1+p2+p3)/3；PMF p/3、p²/3、p³/3，其餘為 0 分。
export function wholeGame(config, perMap) {
  const p = perMap.reduce((acc, m) => acc.add(m.p), ZERO).div(perMap.length);
  const third = new Rational(1n, 3n);
  const g = BigInt(config.goldScore), c = BigInt(config.coinScore);
  const branches = [
    { score: g, prob: p.mul(third) },
    { score: g + c, prob: p.mul(p).mul(third) },
    { score: g + 2n * c, prob: p.mul(p).mul(p).mul(third) },
  ];
  const success = branches.reduce((acc, b) => acc.add(b.prob), ZERO);

  // 相同得分的支點合併（例如金礦 0、金幣 0 的設定）
  const pmfMap = new Map();
  pmfMap.set(0n, ONE.sub(success));
  for (const b of branches) pmfMap.set(b.score, (pmfMap.get(b.score) || ZERO).add(b.prob));
  const pmf = [...pmfMap.entries()].sort((x, y) => (x[0] < y[0] ? -1 : 1)).map(([score, prob]) => ({ score, prob }));

  let running = ZERO;
  const cdf = pmf.map(({ score, prob }) => { running = running.add(prob); return { score, prob: running }; });
  const E = pmf.reduce((acc, { score, prob }) => acc.add(prob.mul(score)), ZERO);
  const E2 = pmf.reduce((acc, { score, prob }) => acc.add(prob.mul(score * score)), ZERO);
  const Var = E2.sub(E.mul(E));

  const avgActions = perMap.reduce((s, m) => s + m.expectedActions, 0) / perMap.length;
  const pNum = p.toNumber();
  const gameActions = avgActions * (1 + (2 * pNum) / 3 + (pNum * pNum) / 3);

  return { p, pmf, cdf, E, E2, Var, PS: success, avgActions, gameActions };
}

export function analyze(config, { tieOrder = DEFAULT_TIE_ORDER, mapIds = ['1', '2', '3'], solver } = {}) {
  const started = performance.now();
  solver ??= new RouteSolver(config, { tieOrder });
  if (solver.config.configId !== config.configId || solver.tieOrder !== tieOrder) {
    throw new Error('solver 的設定或平手規則與這次分析不同，不能共用快取');
  }
  const perMap = mapIds.map(mapId => {
    const r = solver.mapStart(mapId);
    return { mapId, p: r.value, expectedActions: r.actions };
  });
  const whole = wholeGame(config, perMap);
  return {
    ruleset: RULESET,
    version: ROUTE_VERSION,
    source: 'exact_dp',
    configId: config.configId,
    config,
    tieOrder,
    ignores: ['timeout', 'abandon'],
    perMap,
    ...whole,
    stats: { states: solver.stateCount, cacheHits: solver.hits, cacheMisses: solver.misses, ms: performance.now() - started },
  };
}

export function serializeAnalysis(result) {
  const r = v => v.toJSON();
  return {
    ruleset: result.ruleset,
    version: result.version,
    source: result.source,
    configId: result.configId,
    config: result.config,
    tieOrder: result.tieOrder,
    ignores: result.ignores,
    perMap: result.perMap.map(m => ({ mapId: Number(m.mapId), p: r(m.p), expectedActions: round4(m.expectedActions) })),
    p: r(result.p),
    pmf: result.pmf.map(x => ({ score: Number(x.score), prob: r(x.prob) })),
    cdf: result.cdf.map(x => ({ score: Number(x.score), prob: r(x.prob) })),
    E: r(result.E),
    E2: r(result.E2),
    Var: r(result.Var),
    PS: r(result.PS),
    expectedActions: { perMapAverage: round4(result.avgActions), perGame: round4(result.gameActions) },
    stats: { states: result.stats.states, cacheHits: result.stats.cacheHits, cacheMisses: result.stats.cacheMisses, ms: Math.round(result.stats.ms) },
  };
}

function round4(x) { return Math.round(x * 1e4) / 1e4; }
