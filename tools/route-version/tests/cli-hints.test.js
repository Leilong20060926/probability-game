import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { makeConfig } from '../../../shared/route-config.js';
import { RouteSolver, hintsForState } from '../../../shared/route-analysis.js';
import { newRouteGame, routeAct, solverState } from '../../../shared/route-engine.js';
import { mulberry32 } from '../simulate.mjs';

const cli = fileURLToPath(new URL('../cli.mjs', import.meta.url));
const run = (...args) => JSON.parse(execFileSync(process.execPath, [cli, ...args], { encoding: 'utf8' }));
const fraction = /^\d+$/;

test('CLI: exact JSON with string fractions, full config snapshot and reproduction info', () => {
  const out = run('--scenario', 'base', '--format', 'json');
  assert.equal(out.source, 'exact_dp');
  assert.equal(out.ruleset, 'route-v1');
  assert.equal(out.version, '0.5.0');
  assert.match(out.configId, /^route-v1-[0-9a-f]{16}$/);
  assert.equal(out.tieOrder, 'mergedByPay');
  assert.deepEqual(out.ignores, ['timeout', 'abandon']);
  assert.deepEqual(out.config.deck, { H: 4, V: 4, B: 2, X: 1, R: 5 });
  assert.equal(out.config.maxRockCost, 3);
  assert.deepEqual(out.p, { numerator: '5780251', denominator: '7567560', decimal: '0.763820' });
  for (const v of [out.E, out.E2, out.Var, out.PS, ...out.pmf.map(x => x.prob), ...out.cdf.map(x => x.prob)]) {
    assert.match(v.numerator, fraction);
    assert.match(v.denominator, fraction);
  }
  assert.deepEqual(out.pmf.map(x => x.score), [0, 60, 80, 100]);
  assert.equal(out.expectedActions.perGame, 6.4313);
  assert.ok(out.stats.states > 0 && out.stats.ms >= 0 && out.stats.cacheHits > 0);
});

test('CLI: --set produces the same exact result as the named scenario and a different configId', () => {
  const viaSet = run('--set', 'deck.R=4');
  const named = run('--scenario', 'rocks4');
  assert.deepEqual(viaSet.p, named.p);
  assert.equal(viaSet.configId, named.configId);
  assert.notEqual(viaSet.configId, run('--scenario', 'base').configId);

  const hv = run('--set', 'maps.1.B=HV,HV');
  assert.deepEqual(hv.perMap[0].p, { numerator: '63097', denominator: '78624', decimal: '0.802516' });
  const oldRule = run('--set', 'maxRockCost=null');
  assert.deepEqual(oldRule.p, { numerator: '125831', denominator: '206388', decimal: '0.609682' });
});

test('CLI: unknown scenario or bad tie order fails loudly instead of returning something', () => {
  assert.throws(() => execFileSync(process.execPath, [cli, '--scenario', 'nope'], { stdio: 'pipe' }));
  assert.throws(() => execFileSync(process.execPath, [cli, '--tie-order', 'fewestActions'], { stdio: 'pipe' }));
});

test('hints agree with the main solver along real engine play-throughs', () => {
  const config = makeConfig();
  const solver = new RouteSolver(config);
  const rng = mulberry32(42);
  let checked = 0;

  for (let i = 0; i < 40; i++) {
    const game = newRouteGame({ playerId: 'p', attempt: 1, now: 0, config, id: `h${i}`, rng });
    while (game.status === 'playing') {
      const s = solverState(game);
      const best = solver.best(s.mapId, s.pos, s.a, s.hand, s.deck);
      const hints = hintsForState(solver, s);
      const marked = hints.filter(h => h.best);
      assert.equal(marked.length, 1, 'exactly one best option');
      assert.ok(marked[0].value.eq(best.value), 'best hint value = solver best value');
      assert.deepEqual(marked[0].action, best.choice, 'best hint = solver choice (same tie policy)');
      assert.ok(hints.every(h => !h.value.gt(best.value)), 'no option beats the optimum');
      assert.deepEqual(hints.map(h => h.tieRank), hints.map((_, k) => k));
      checked++;

      // 走一個非最佳但合法的動作，確認提示在各種狀態都一致
      const pick = hints[Math.floor(rng() * hints.length)].action;
      const action = pick.pay ? { type: pick.type, pay: { H: pick.pay[0], V: pick.pay[1], B: pick.pay[2], X: pick.pay[3] } } : pick;
      assert.ok(routeAct(game, action, 0, rng).ok);
    }
  }
  assert.ok(checked > 100);
});
