// 蒙地卡羅驗證：用共用規則引擎實際發牌，照求解器的最佳策略（含固定平手規則）出牌。
// 只用來驗證精確結果，不當主要結果。

import { newRouteGame, routeAct, solverState } from '../../shared/route-engine.js';
import { RouteSolver } from '../../shared/route-analysis.js';

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function toEngineAction(choice) {
  if (choice.type === 'pave' || choice.type === 'dig') {
    const [H, V, B, X] = choice.pay;
    return { type: choice.type, pay: { H, V, B, X } };
  }
  return { ...choice };
}

function playOut(game, solver, rng) {
  const now = game.startedAt;
  while (game.status === 'playing') {
    const s = solverState(game);
    const { choice } = solver.best(s.mapId, s.pos, s.a, s.hand, s.deck);
    const result = routeAct(game, toEngineAction(choice), now, rng);
    if (!result.ok) throw new Error(`simulator chose an illegal action: ${JSON.stringify(choice)} → ${result.message}`);
  }
}

function interval(successes, n) {
  const p = successes / n;
  const half = 1.96 * Math.sqrt((p * (1 - p)) / n);
  return { estimate: p, low: p - half, high: p + half, n };
}

// 單張地圖：固定 mapId、該圖即金礦，所以成功＝通關。
export function simulateMap(config, mapId, runs, seed, solver = new RouteSolver(config)) {
  const rng = mulberry32(seed);
  let wins = 0;
  for (let i = 0; i < runs; i++) {
    const game = newRouteGame({ playerId: 'sim', attempt: i + 1, rng, now: 0, config, id: `sim-${i}`, script: { mapIds: [Number(mapId)], goldMapIndex: 1 } });
    playOut(game, solver, rng);
    if (game.reason === 'gold') wins++;
  }
  return { mapId: Number(mapId), seed, ...interval(wins, runs) };
}

// 整局：地圖種類、金礦位置都由引擎隨機決定。
export function simulateGames(config, games, seed, solver = new RouteSolver(config)) {
  const rng = mulberry32(seed);
  const scores = new Map();
  let maps = 0, mapWins = 0, actions = 0;
  for (let i = 0; i < games; i++) {
    const game = newRouteGame({ playerId: 'sim', attempt: i + 1, rng, now: 0, config, id: `sim-${i}` });
    playOut(game, solver, rng);
    scores.set(game.score, (scores.get(game.score) || 0) + 1);
    maps += game.completedMaps.length;
    mapWins += game.completedMaps.filter(m => m.result !== 'fail').length;
    actions += game.turn;
  }
  const pmf = [...scores.entries()].sort((a, b) => a[0] - b[0]).map(([score, n]) => ({ score, prob: n / games }));
  return {
    seed,
    games,
    maps,
    mapPassRate: interval(mapWins, maps),
    pmf,
    meanActionsPerGame: actions / games,
  };
}
