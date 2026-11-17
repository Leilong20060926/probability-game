// 蒙地卡羅獨立驗證（約 35 秒）：npm run test:route:sim
// seed 是事先固定的，不為了讓測試通過去挑；95% 區間本身有約 5% 機率不含真值，
// 若失敗請先檢查規則與策略，不要換 seed。
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { makeConfig } from '../../../shared/route-config.js';
import { RouteSolver } from '../../../shared/route-analysis.js';
import { simulateGames, simulateMap } from '../simulate.mjs';

const SEED = 20261118;
const config = makeConfig();
const solver = new RouteSolver(config);
const exact = ['1', '2', '3'].map(id => solver.mapStart(id).value.toNumber());
const pExact = exact.reduce((s, x) => s + x, 0) / 3;

test('each map, 200,000 runs under the optimal policy: exact p_i inside the 95% interval', () => {
  ['1', '2', '3'].forEach((id, k) => {
    const sim = simulateMap(config, id, 200_000, SEED + k + 1, solver);
    console.log(`map ${id}: p̂=${sim.estimate.toFixed(4)} [${sim.low.toFixed(4)}, ${sim.high.toFixed(4)}] exact ${exact[k].toFixed(4)}`);
    assert.ok(sim.low <= exact[k] && exact[k] <= sim.high);
  });
});

test('100,000 whole games: map pass rate and simulated PMF agree with the exact model', () => {
  const sim = simulateGames(config, 100_000, SEED, solver);
  const { mapPassRate: r } = sim;
  console.log(`games=${sim.games} maps=${sim.maps} p̂=${r.estimate.toFixed(4)} [${r.low.toFixed(4)}, ${r.high.toFixed(4)}] exact ${pExact.toFixed(4)}`);
  console.log(`PMF ${JSON.stringify(sim.pmf)}  actions/game ${sim.meanActionsPerGame.toFixed(4)}`);
  assert.ok(r.low <= pExact && pExact <= r.high);

  const p = pExact;
  const model = { 0: 1 - (p + p * p + p ** 3) / 3, 60: p / 3, 80: (p * p) / 3, 100: p ** 3 / 3 };
  for (const { score, prob } of sim.pmf) {
    const se = Math.sqrt((model[score] * (1 - model[score])) / sim.games);
    assert.ok(Math.abs(prob - model[score]) < 4 * se, `P(X=${score}) sim ${prob} vs exact ${model[score]}`);
  }
  assert.ok(Math.abs(sim.meanActionsPerGame - 5.9811) < 0.05);
});
