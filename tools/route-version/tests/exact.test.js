// 規格 ROUTE_V1_SPEC.md 第三節 A～D：精確項用有理數相等；動作數 ±0.01。
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Rational } from '../../../shared/rational.js';
import { makeConfig, scenarioConfig } from '../../../shared/route-config.js';
import { analyze, RouteSolver, initialDealDistribution } from '../../../shared/route-analysis.js';

const R = s => Rational.from(s);
const eqR = (actual, expected, label) => assert.ok(actual.eq(R(expected)), `${label}: got ${actual}, expected ${expected}`);
const near = (actual, expected, tol, label) => assert.ok(Math.abs(actual - expected) <= tol, `${label}: got ${actual}, expected ${expected} ±${tol}`);

const base = analyze(makeConfig());

test('A. legacy regression: map 1 alone, deck (4,4,2,1,5) hand 5 and deck (4,4,2,1,4) hand 4', () => {
  eqR(new RouteSolver(makeConfig()).mapStart('1').value, '389017/617760', 'A1');
  eqR(new RouteSolver(makeConfig({ deck: { R: 4 }, handLimit: 4 })).mapStart('1').value, '1864894/2627625', 'A2');
});

test('B. baseline exact p_i, p, PMF, E and Var', () => {
  const [p1, p2, p3] = base.perMap.map(m => m.p);
  eqR(p1, '389017/617760', 'p1');
  eqR(p2, '4577077/7567560', 'p2');
  eqR(p3, '17995499/30270240', 'p3');
  eqR(base.p, '125831/206388', 'p');

  const pmf = Object.fromEntries(base.pmf.map(x => [Number(x.score), x.prob]));
  eqR(pmf[0], '15753845906636293/26373913795809216', 'P(X=0)');
  eqR(pmf[60], '125831/619164', 'P(X=60)');
  eqR(pmf[80], '15833440561/127788019632', 'P(X=80)');
  eqR(pmf[100], '1992337659231191/26373913795809216', 'P(X=100)');
  eqR(base.pmf.reduce((s, x) => s.add(x.prob), R('0')), '1', 'PMF sums to 1');

  eqR(base.E, '195563555582424095/6593478448952304', 'E');
  eqR(base.Var, '60876528786036948852862724619816575/43473958056798480504795266908416', 'Var');
});

test('B. baseline derived values: E2, P(S), CDF and expected actions', () => {
  near(base.E2.toNumber(), 2280.0232, 5e-5, 'E2');
  near(base.PS.toNumber(), 0.402673, 5e-7, 'P(S)');
  eqR(base.PS, base.pmf.filter(x => x.score > 0n).reduce((s, x) => s.add(x.prob), R('0')), 'P(S)=P(X>0)');
  const cdf = Object.fromEntries(base.cdf.map(x => [Number(x.score), x.prob.toNumber()]));
  near(cdf[0], 0.597327, 5e-7, 'F(0)');
  near(cdf[60], 0.800554, 5e-7, 'F(60)');
  near(cdf[80], 0.924458, 5e-7, 'F(80)');
  eqR(base.cdf.at(-1).prob, '1', 'F(100)');

  const [a1, a2, a3] = base.perMap.map(m => m.expectedActions);
  near(a1, 4.0217, 0.01, 'actions map 1');
  near(a2, 4.0444, 0.01, 'actions map 2');
  near(a3, 3.6589, 0.01, 'actions map 3');
  near(base.avgActions, 3.9083, 0.01, 'actions per map');
  near(base.gameActions, 5.9811, 0.01, 'actions per game');
});

const C = {
  rocks4: { p: ['158021/171990', '1477877/1576575', '4314851/4729725', '2909791/3153150'], E: 67.36, Var: 1006.14, PS: 0.8534 },
  forceA: { p: ['18059617/30270240', '3044221/6054048', '390955/756756', '1881497/3492720'], E: 23.72, Var: 1223.79, PS: 0.3284 },
  forceB: { p: ['32435/77616', '5561737/10090080', '214793/432432', '44370371/90810720'], E: 20.03, Var: 1083.38, PS: 0.2813 },
  hand4: { p: ['12049151/30270240', '31554461/75675600', '2324137/5605600', '23263297/56756700'], E: 14.97, Var: 855.60, PS: 0.2156 },
  noDig: { p: ['727619/1164240', '2288471/3783780', '73379/123552', '18401239/30270240'], E: 29.50, Var: 1396.36, PS: 0.4007 },
  map1BHVHV: { p: ['1065413/1681680', '4577077/7567560', '17995499/30270240', '18493747/30270240'], E: 29.77, Var: 1403.09, PS: 0.4041 },
};

for (const [name, expected] of Object.entries(C)) {
  test(`C. comparison scenario ${name}`, () => {
    const r = analyze(scenarioConfig(name));
    r.perMap.forEach((m, i) => eqR(m.p, expected.p[i], `${name} p${i + 1}`));
    eqR(r.p, expected.p[3], `${name} p`);
    assert.equal(r.E.toDecimal(2), expected.E.toFixed(2), `${name} E`);
    assert.equal(r.Var.toDecimal(2), expected.Var.toFixed(2), `${name} Var`);
    assert.equal(r.PS.toDecimal(4), expected.PS.toFixed(4), `${name} P(S)`);
  });
}

test('D. opening hand H count is HG(11,4,5) and the no-rock probability is C(11,5)/C(16,5)', () => {
  const dist = initialDealDistribution(makeConfig());
  const byH = [0, 1, 2, 3, 4].map(() => R('0'));
  let noRock = R('0');
  let total = R('0');
  for (const [key, prob] of dist) {
    const [hand, rocks] = key.split('|');
    const h = Number(hand.split(',')[0]);
    byH[h] = byH[h].add(prob);
    if (rocks === '0') noRock = noRock.add(prob);
    total = total.add(prob);
  }
  eqR(total, '1', 'total');
  [21, 140, 210, 84, 7].forEach((n, h) => eqR(byH[h], `${n}/462`, `P(H=${h})`));
  eqR(byH.reduce((s, p, h) => s.add(p.mul(h)), R('0')), '20/11', 'E[H]');
  eqR(noRock, '462/4368', 'no rock while dealing');
});

test('tie order only changes expected actions: pave-then-dig gives map 3 ≈ 3.7063, not the reference 3.6589', () => {
  const alt = analyze(makeConfig(), { tieOrder: 'paveThenDig' });
  alt.perMap.forEach((m, i) => assert.ok(m.p.eq(base.perMap[i].p), 'pass rates are independent of the tie order'));
  near(alt.perMap[2].expectedActions, 3.7063, 0.001, 'paveThenDig map 3');
  assert.ok(Math.abs(alt.perMap[2].expectedActions - 3.6589) > 0.01, 'paveThenDig does not reproduce the reference');
});

test('solver caches are per config: a different config never reuses another solver', () => {
  const solver = new RouteSolver(makeConfig());
  assert.throws(() => analyze(scenarioConfig('rocks4'), { solver }), /不能共用快取/);
  assert.notEqual(makeConfig().configId, scenarioConfig('rocks4').configId);
  assert.equal(makeConfig().configId, makeConfig().configId);
});
