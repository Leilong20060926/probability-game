// 規格 ROUTE_V1_SPEC.md 第三節 A～D：精確項用有理數相等；動作數 ±0.01。
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Rational } from '../../../shared/rational.js';
import { makeConfig, scenarioConfig, SEGMENTS } from '../../../shared/route-config.js';
import { analyze, RouteSolver, initialDealDistribution } from '../../../shared/route-analysis.js';

const R = s => Rational.from(s);
const eqR = (actual, expected, label) => assert.ok(actual.eq(R(expected)), `${label}: got ${actual}, expected ${expected}`);
const near = (actual, expected, tol, label) => assert.ok(Math.abs(actual - expected) <= tol, `${label}: got ${actual}, expected ${expected} ±${tol}`);

const base = analyze(makeConfig());

// 0.5.0 起每段落石加需求最多 3 張（maxRockCost）。原規格 A～C 的數值是「不設上限」的規則，
// 保留在 noRockCap 情境並在下方逐項比對；基準改為新規則的精確值（另以獨立 Python 狀態遞迴交叉驗證）。
const old = analyze(scenarioConfig('noRockCap'));

test('A. legacy regression (no rock cap): map 1 alone, deck (4,4,2,1,5) hand 5 and deck (4,4,2,1,4) hand 4', () => {
  eqR(new RouteSolver(makeConfig({ maxRockCost: null })).mapStart('1').value, '389017/617760', 'A1');
  eqR(new RouteSolver(makeConfig({ deck: { R: 4 }, handLimit: 4, maxRockCost: null })).mapStart('1').value, '1864894/2627625', 'A2');
});

test('B. original spec values are reproduced exactly with the rock cap removed (noRockCap)', () => {
  const [p1, p2, p3] = old.perMap.map(m => m.p);
  eqR(p1, '389017/617760', 'p1');
  eqR(p2, '4577077/7567560', 'p2');
  eqR(p3, '17995499/30270240', 'p3');
  eqR(old.p, '125831/206388', 'p');
  const pmf = Object.fromEntries(old.pmf.map(x => [Number(x.score), x.prob]));
  eqR(pmf[0], '15753845906636293/26373913795809216', 'P(X=0)');
  eqR(pmf[60], '125831/619164', 'P(X=60)');
  eqR(pmf[80], '15833440561/127788019632', 'P(X=80)');
  eqR(pmf[100], '1992337659231191/26373913795809216', 'P(X=100)');
  eqR(old.E, '195563555582424095/6593478448952304', 'E');
  eqR(old.Var, '60876528786036948852862724619816575/43473958056798480504795266908416', 'Var');
  const [a1, a2, a3] = old.perMap.map(m => m.expectedActions);
  near(a1, 4.0217, 0.01, 'actions map 1');
  near(a2, 4.0444, 0.01, 'actions map 2');
  near(a3, 3.6589, 0.01, 'actions map 3');
  near(old.gameActions, 5.9811, 0.01, 'actions per game');
});

test('B. baseline (rock cost capped at 3): exact p_i, p, PMF, E and Var', () => {
  const [p1, p2, p3] = base.perMap.map(m => m.p);
  eqR(p1, '24345551/30270240', 'p1');
  eqR(p2, '2610109/3363360', 'p2');
  eqR(p3, '269081/378378', 'p3');
  eqR(base.p, '5780251/7567560', 'p');

  const pmf = Object.fromEntries(base.pmf.map(x => [Number(x.score), x.prob]));
  eqR(pmf[0], '523145321420516293589/1300136268971187648000', 'P(X=0)');
  eqR(pmf[60], '5780251/22702680', 'P(X=60)');
  eqR(pmf[80], '33411301623001/171803893060800', 'P(X=80)');
  eqR(pmf[100], '193125709617653153251/1300136268971187648000', 'P(X=100)');
  eqR(pmf[60], base.p.div(R('3')), 'P(X=60)=p/3');
  eqR(base.pmf.reduce((s, x) => s.add(x.prob), R('0')), '1', 'PMF sums to 1');

  eqR(base.E, '594013258319495563459/13001362689711876480', 'E');
  eqR(base.Var, '263559708496530623997316749253650332294519/169035431789432039334004077562777190400', 'Var');
});

test('B. baseline derived values: E2, P(S), CDF and expected actions', () => {
  near(base.E2.toNumber(), 3646.6405, 5e-4, 'E2');
  near(base.PS.toNumber(), 0.597623, 5e-7, 'P(S)');
  eqR(base.PS, base.pmf.filter(x => x.score > 0n).reduce((s, x) => s.add(x.prob), R('0')), 'P(S)=P(X>0)');
  const cdf = Object.fromEntries(base.cdf.map(x => [Number(x.score), x.prob.toNumber()]));
  near(cdf[0], 0.402377, 5e-7, 'F(0)');
  near(cdf[60], 0.656984, 5e-7, 'F(60)');
  near(cdf[80], 0.851457, 5e-7, 'F(80)');
  eqR(base.cdf.at(-1).prob, '1', 'F(100)');

  const [a1, a2, a3] = base.perMap.map(m => m.expectedActions);
  near(a1, 3.7536, 0.01, 'actions map 1');
  near(a2, 3.7943, 0.01, 'actions map 2');
  near(a3, 3.7768, 0.01, 'actions map 3');
  near(base.avgActions, 3.7749, 0.01, 'actions per map');
  near(base.gameActions, 6.4313, 0.01, 'actions per game');
});

const C = {
  rocks4: { p: ['3109/3185', '9368323/9459450', '2905817/3153150', '13659752/14189175'], E: 73.71, Var: 673.54, PS: 0.9272 },
  forceA: { p: ['324437/432432', '20095469/30270240', '914513/1441440', '298129/436590'], E: 36.71, Var: 1528.28, PS: 0.4892 },
  forceB: { p: ['347211/560560', '7173077/10090080', '405959/630630', '19918219/30270240'], E: 34.20, Var: 1493.13, PS: 0.4586 },
  hand4: { p: ['64710409/151351200', '700897/1544400', '179369/363825', '18910529/41277600'], E: 17.96, Var: 995.29, PS: 0.2547 },
  noDig: { p: ['3972131/5045040', '163175/216216', '591259/864864', '22457117/30270240'], E: 43.13, Var: 1565.69, PS: 0.5669 },
  map1BHVHV: { p: ['63097/78624', '2610109/3363360', '269081/378378', '34654903/45405360'], E: 45.62, Var: 1559.54, PS: 0.5968 },
  // 舊規則（不設上限）＝原規格基準
  noRockCap: { p: ['389017/617760', '4577077/7567560', '17995499/30270240', '125831/206388'], E: 29.66, Var: 1400.30, PS: 0.4027 },
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

test('rock cap: the required payment never exceeds the hand limit, so no segment is impossible by card count', () => {
  const config = makeConfig();
  const worst = Math.max(...Object.values(SEGMENTS).map(n => n.H + n.V + n.B)) + config.maxRockCost;
  assert.ok(worst <= config.handLimit, `worst payment ${worst} ≤ hand limit ${config.handLimit}`);
});

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

test('tie order only changes expected actions: pave-then-dig gives map 3 ≈ 3.7063, not the reference 3.6589 (no rock cap)', () => {
  const alt = analyze(scenarioConfig('noRockCap'), { tieOrder: 'paveThenDig' });
  alt.perMap.forEach((m, i) => assert.ok(m.p.eq(old.perMap[i].p), 'pass rates are independent of the tie order'));
  near(alt.perMap[2].expectedActions, 3.7063, 0.001, 'paveThenDig map 3');
  assert.ok(Math.abs(alt.perMap[2].expectedActions - 3.6589) > 0.01, 'paveThenDig does not reproduce the reference');
});

test('solver caches are per config: a different config never reuses another solver', () => {
  const solver = new RouteSolver(makeConfig());
  assert.throws(() => analyze(scenarioConfig('rocks4'), { solver }), /不能共用快取/);
  assert.notEqual(makeConfig().configId, scenarioConfig('rocks4').configId);
  assert.equal(makeConfig().configId, makeConfig().configId);
});
