// 共用規則引擎（shared/route-engine.js）的邊界：落石位置、岔路、末段、付款、失敗、換圖、嚴格截止。
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { makeConfig } from '../../../shared/route-config.js';
import { legalActions } from '../../../shared/route-analysis.js';
import {
  newRouteGame, routeAct, routeAbandon, routeCheckTimeout, routeRecordLifecycle, routePublicView,
} from '../../../shared/route-engine.js';
import { mulberry32 } from '../simulate.mjs';

const config = makeConfig();
const T0 = 1_000_000;

// 以 prefix 開頭、其餘依 HVBXR 補滿成合法 16 張牌庫
function deck(prefix) {
  const counts = { H: 4, V: 4, B: 2, X: 1, R: 5 };
  for (const c of prefix) {
    counts[c]--;
    assert.ok(counts[c] >= 0, `prefix 用了太多 ${c}`);
  }
  return [...prefix, ...'HVBXR'.split('').flatMap(t => Array(counts[t]).fill(t))];
}

function game({ mapIds = [1], decks, goldMapIndex = 1 } = {}) {
  return newRouteGame({ playerId: 'p', attempt: 1, now: T0, config, id: 'g', script: { mapIds, decks, goldMapIndex } });
}

const act = (g, action, now = T0 + 1000) => routeAct(g, action, now, () => 0);
const ok = (g, action, now) => { const r = act(g, action, now); assert.ok(r.ok, r.message); return r; };
const types = (g, from = 0) => g.events.slice(from).map(e => e.type);
const hand = (H = 0, V = 0, B = 0, X = 0) => ({ H, V, B, X });

test('opening deal: rocks leave play and add to the first segment; deck is 16-5-r0', () => {
  const g = game({ decks: [deck('RRHHVXB')] });
  assert.equal(g.mapIndex, 1);
  assert.equal(g.mapId, 1);
  assert.equal(g.pos, 'F');
  assert.equal(g.a, 2);
  assert.deepEqual(g.hand, hand(2, 1, 1, 1));
  assert.equal(g.deck.length, 16 - 5 - 2);
  assert.deepEqual(types(g), ['map_start', 'rock', 'rock', 'draw', 'draw', 'draw', 'draw', 'draw']);
  const v = routePublicView(g);
  assert.equal(v.paveCost, 4);
  assert.equal(v.digCost, 5);
});

test('full A-line walk: rocks at the fork carry into A1, refill rocks land on the new segment, last segment draws nothing', () => {
  const g = game({ decks: [deck('HHVVB' + 'RHRX' + 'RVHB')] });
  assert.deepEqual(g.hand, hand(2, 2, 1, 0));

  ok(g, { type: 'pave', pay: hand(2) });
  assert.equal(g.pos, 'K');
  assert.equal(g.a, 2, 'two rocks drawn while refilling at the fork accumulate on a');
  assert.deepEqual(g.hand, hand(1, 2, 1, 1));
  assert.equal(routePublicView(g).phase, 'fork');
  assert.equal(g.turn, 1);
  assert.equal(act(g, { type: 'pave', pay: hand(1, 2) }).ok, false, 'cannot pay at the fork before choosing');

  const before = g.events.length;
  ok(g, { type: 'choose_branch', branch: 'A' });
  assert.equal(g.turn, 1, 'choosing a branch is not an action');
  assert.equal(g.pos, 'A0');
  assert.equal(g.a, 2, 'a is carried into the first segment of the chosen line');
  assert.deepEqual(types(g, before), ['choose_branch']);
  assert.equal(act(g, { type: 'choose_branch', branch: 'B' }).ok, false, 'no going back');

  ok(g, { type: 'pave', pay: hand(0, 2, 1) });
  assert.equal(g.pos, 'A1');
  assert.equal(g.a, 1, 'a resets on advance; the refill rock lands on A1');
  assert.deepEqual(g.hand, hand(2, 1, 1, 1));

  ok(g, { type: 'pave', pay: hand(1, 1, 1) });
  assert.equal(g.pos, 'A2');
  assert.equal(g.deck.length, 0);
  assert.equal(g.a, 2);
  assert.deepEqual(g.hand, hand(1, 1, 0, 1));

  const beforeLast = g.events.length;
  ok(g, { type: 'pave', pay: hand(1, 1, 0, 1) });
  assert.deepEqual(types(g, beforeLast), ['pay', 'reveal', 'map_end', 'end'], 'no refill after the last segment');
  assert.equal(g.reason, 'gold', 'gold beats an empty deck and empty hand on the same action');
  assert.equal(g.score, 60);
  assert.equal(g.turn, 4);
  assert.deepEqual(g.completedMaps, [{ mapIndex: 1, mapId: 1, branch: 'A', result: 'gold' }]);
});

test('last segment does not refill even when the deck still has cards', () => {
  const g = game({ decks: [deck('HHHVV' + 'XB' + 'HV')] });
  ok(g, { type: 'pave', pay: hand(2) });
  ok(g, { type: 'choose_branch', branch: 'B' });
  ok(g, { type: 'pave', pay: hand(1, 0, 0, 1) });
  assert.equal(g.pos, 'B1');
  const deckBefore = g.deck.length;
  ok(g, { type: 'pave', pay: hand(1, 1) });
  assert.equal(g.reason, 'gold');
  assert.equal(g.deck.length, deckBefore);
  assert.deepEqual(g.hand, hand(0, 2, 1, 0));
});

test('cross covers several missing directions; extra a cards are any road card', () => {
  const g = game({ decks: [deck('XVVBR' + 'H')] });
  // a=1 on HH: 3 cards; X covers only one gap, so {V:2,X:1} is short one H
  assert.equal(g.a, 1);
  assert.equal(act(g, { type: 'pave', pay: hand(0, 2, 0, 1) }).ok, false);
  assert.deepEqual(g.hand, hand(1, 2, 1, 1));
  ok(g, { type: 'pave', pay: hand(1, 0, 1, 1) }, T0 + 1000);

  // first 改成 HV：手牌 H2 B2 X1、沒有 V
  const hv = makeConfig({ maps: { 1: { first: 'HV' } } });
  const h = newRouteGame({ playerId: 'p', attempt: 1, now: T0, config: hv, id: 'g2', script: { mapIds: [1], goldMapIndex: 1, decks: [deck('HBBXH')] } });
  assert.deepEqual(h.hand, hand(2, 0, 2, 1));
  assert.equal(routeAct(h, { type: 'pave', pay: hand(0, 0, 1, 1) }, T0 + 1, () => 0).ok, false, 'one X fills one gap, not two');
  assert.ok(routeAct(h, { type: 'pave', pay: hand(1, 0, 0, 1) }, T0 + 1, () => 0).ok, 'X substitutes the missing V');

  // 兩張十字同時補 H 與 V 兩個缺口（需要 X:2 的設定）
  const twoX = makeConfig({ deck: { H: 3, X: 2 }, maps: { 1: { first: 'HV' } } });
  const counts = { H: 3, V: 4, B: 2, X: 2, R: 5 };
  const prefix = 'XXBBV';
  for (const c of prefix) counts[c]--;
  const d2 = [...prefix, ...'HVBXR'.split('').flatMap(t => Array(counts[t]).fill(t))];
  const k = newRouteGame({ playerId: 'p', attempt: 1, now: T0, config: twoX, id: 'g3', script: { mapIds: [1], goldMapIndex: 1, decks: [d2] } });
  assert.ok(routeAct(k, { type: 'pave', pay: hand(0, 0, 0, 2) }, T0 + 1, () => 0).ok, 'X×2 covers both H and V');
});

test('every distinct legal payment is a separate action, and dig stays legal when paving is possible', () => {
  const actions = legalActions(config, '1', 'F', 1, [2, 1, 1, 1], [2, 3, 1, 0, 4]);
  const keyOf = a => `${a.type}:${a.pay ?? a.discard}`;
  assert.equal(new Set(actions.map(keyOf)).size, actions.length, 'no duplicates');

  // 暴力列舉核對
  const brute = [];
  for (let h = 0; h <= 2; h++) for (let v = 0; v <= 1; v++) for (let b = 0; b <= 1; b++) for (let x = 0; x <= 1; x++) {
    const n = h + v + b + x;
    const gap = Math.max(0, 2 - h);
    if (n === 3 && gap <= x) brute.push(`pave:${[h, v, b, x]}`);
    if (n === 4) brute.push(`dig:${[h, v, b, x]}`);
  }
  const listed = actions.filter(a => a.type !== 'exchange').map(keyOf);
  assert.deepEqual([...listed].sort(), brute.sort());
  assert.ok(listed.some(k => k.startsWith('pave')) && listed.some(k => k.startsWith('dig')));
  assert.deepEqual(actions.filter(a => a.type === 'exchange').map(a => a.discard), ['H', 'V', 'B', 'X']);

  const g = game({ decks: [deck('HHVVB')] });
  ok(g, { type: 'dig', pay: hand(1, 1, 1) });
  assert.equal(g.pos, 'K');
});

test('illegal or unaffordable actions change nothing at all', () => {
  const g = game({ decks: [deck('HHVVB')] });
  const snapshot = structuredClone(g);
  for (const bad of [
    { type: 'pave', pay: hand(1) },
    { type: 'pave', pay: hand(3) },
    { type: 'pave', pay: hand(2, 1) },
    { type: 'pave', pay: { H: 2, R: 1 } },
    { type: 'pave', pay: { H: -1, V: 3 } },
    { type: 'pave', pay: { H: 1.5, V: 0.5 } },
    { type: 'dig', pay: hand(1, 1) },
    { type: 'dig', pay: hand(0, 0, 0, 3) },
    { type: 'exchange', discard: 'X' },
    { type: 'exchange', discard: 'R' },
    { type: 'choose_branch', branch: 'A' },
    { type: 'teleport' },
  ]) {
    const r = act(g, bad);
    assert.equal(r.ok, false, JSON.stringify(bad));
    assert.deepEqual(g, snapshot, `state changed after ${JSON.stringify(bad)}`);
  }
});

test('exchange: rocks drawn while exchanging add to the current segment', () => {
  const g = game({ decks: [deck('HHVVB' + 'RRX')] });
  ok(g, { type: 'exchange', discard: 'V' });
  assert.equal(g.pos, 'F');
  assert.equal(g.a, 2);
  assert.deepEqual(g.hand, hand(2, 1, 1, 1));
  assert.equal(g.turn, 1);
  assert.equal(g.mapActionCount, 1);
});

test('deck of only rocks: exchange draws them all, then an unpayable hand fails the map', () => {
  const g = game({ decks: [deck('HVVBH')] });
  g.deck = ['R', 'R'];
  ok(g, { type: 'exchange', discard: 'H' });
  assert.equal(g.a, 2);
  assert.equal(g.deck.length, 0);
  assert.deepEqual(g.hand, hand(1, 2, 1, 0));
  assert.equal(g.reason, 'exhausted');
  assert.equal(g.score, 0);
  assert.deepEqual(types(g).slice(-2), ['map_end', 'end']);
});

test('rock cost is capped at 3: five opening rocks still leave the first segment payable (0.5.0)', () => {
  const g = game({ decks: [deck('RRRRR' + 'HHHHV')] });
  assert.equal(g.a, 3, 'a stops at maxRockCost');
  const rocks = g.events.filter(e => e.type === 'rock');
  assert.equal(rocks.length, 5, 'all five rocks are still flipped and removed');
  assert.deepEqual(rocks.map(e => e.capped), [false, false, false, true, true]);
  ok(g, { type: 'pave', pay: hand(4, 1) });
  assert.equal(g.pos, 'K', 'HH + 3 any = 5 cards: payable with a full hand');
});

test('empty deck is not failure while a payment is still possible', () => {
  // 0.4.0 時這手牌（a=5）永遠付不出；0.5.0 上限 3 後可付。這裡改測「牌庫空才判失敗」本身。
  const g = game({ decks: [deck('RRRRR' + 'VVVVB')] });
  assert.equal(g.a, 3);
  for (let i = 0; i < 6; i++) {
    assert.equal(g.status, 'playing', `still playing before exchange ${i + 1}`);
    ok(g, { type: 'exchange', discard: g.hand.H ? 'H' : g.hand.V ? 'V' : 'B' });
  }
  assert.equal(g.deck.length, 0);
  assert.equal(g.reason, 'exhausted', 'only now: deck empty, HH+3 needs two H/X and dig needs 6 cards');

  const h = game({ decks: [deck('HHVVB')] });
  h.deck = [];
  assert.ok(legalActions(config, '1', 'F', 0, [2, 2, 1, 0], [0, 0, 0, 0, 0]).length > 0);
  ok(h, { type: 'pave', pay: hand(2) });
  assert.equal(h.status, 'playing', 'deck empty after paving, but the fork can still be chosen');
});

test('coin: full reshuffle, a new map draw, hand reset; the game clock never resets; a later failure scores 0', () => {
  const g = game({ mapIds: [1, 1], goldMapIndex: 2, decks: [deck('HHHVV' + 'XB' + 'HV'), deck('RRRRR' + 'HHHHV')] });
  const deadline = g.deadlineAt;
  ok(g, { type: 'pave', pay: hand(2) });
  ok(g, { type: 'choose_branch', branch: 'B' });
  ok(g, { type: 'pave', pay: hand(1, 0, 0, 1) });
  ok(g, { type: 'pave', pay: hand(1, 1) });
  assert.equal(g.coins, 1);
  assert.equal(g.mapIndex, 2);
  assert.equal(g.mapId, 1, 'map kinds can repeat');
  assert.equal(g.pos, 'F');
  assert.equal(g.deck.length, 16 - 10, 'a fresh 16-card deck was dealt');
  assert.deepEqual(g.hand, hand(4, 1, 0, 0));
  assert.equal(g.a, 3, 'rock cost capped at 3');
  assert.equal(g.mapActionCount, 0);
  assert.equal(g.deadlineAt, deadline);
  assert.deepEqual(g.completedMaps, [{ mapIndex: 1, mapId: 1, branch: 'B', result: 'coin' }]);

  // 故意一直棄掉橫／十字，牌庫抽完時付不出 HH+3 → 失敗
  for (let i = 0; i < 6; i++) ok(g, { type: 'exchange', discard: g.hand.H ? 'H' : g.hand.X ? 'X' : g.hand.V ? 'V' : 'B' });
  assert.equal(g.reason, 'exhausted');
  assert.equal(g.score, 0, 'coins are not banked');
  assert.equal(g.coins, 1);
});

test('score is 60 + 20 × coins and the third map is always gold', () => {
  const run = (goldMapIndex, decks, mapIds) => {
    const g = game({ mapIds, goldMapIndex, decks });
    for (let m = 0; m < goldMapIndex; m++) {
      ok(g, { type: 'pave', pay: hand(2) });
      ok(g, { type: 'choose_branch', branch: 'B' });
      ok(g, { type: 'pave', pay: hand(1, 0, 0, 1) });
      ok(g, { type: 'pave', pay: hand(1, 1) });
    }
    return g;
  };
  const d = () => deck('HHHVV' + 'XB' + 'HV');
  assert.equal(run(1, [d()], [1]).score, 60);
  assert.equal(run(2, [d(), d()], [1, 1]).score, 80);
  const third = run(3, [d(), d(), d()], [1, 1, 1]);
  assert.equal(third.score, 100);
  assert.equal(third.mapIndex, 3);
});

test('gold position is uniform over map 1/2/3 and map kinds are uniform, independently', () => {
  const rng = mulberry32(7);
  const gold = [0, 0, 0, 0];
  const kind = [0, 0, 0, 0];
  const N = 30000;
  for (let i = 0; i < N; i++) {
    const g = newRouteGame({ playerId: 'p', attempt: 1, now: 0, config, id: `u${i}`, rng });
    gold[g.goldMapIndex]++;
    kind[g.mapId]++;
  }
  for (const counts of [gold, kind]) {
    for (const k of [1, 2, 3]) assert.ok(Math.abs(counts[k] / N - 1 / 3) < 0.015, `${counts}`);
  }
});

test('strict 300 s cutoff: deadlineAt-1 ms still wins; deadlineAt and later time out without paying', () => {
  const winning = () => {
    const g = game({ decks: [deck('HHHVV' + 'XB' + 'HV')] });
    ok(g, { type: 'pave', pay: hand(2) });
    ok(g, { type: 'choose_branch', branch: 'B' });
    ok(g, { type: 'pave', pay: hand(1, 0, 0, 1) });
    return g;
  };

  const early = winning();
  ok(early, { type: 'pave', pay: hand(1, 1) }, early.deadlineAt - 1);
  assert.equal(early.reason, 'gold');
  assert.equal(early.endedAt, early.deadlineAt - 1);
  assert.equal(routeCheckTimeout(early, early.deadlineAt + 5000), false, 'a confirmed gold is never overwritten');
  assert.equal(early.reason, 'gold');

  for (const offset of [0, 1, 60_000]) {
    const g = winning();
    const handBefore = { ...g.hand };
    const deckBefore = [...g.deck];
    const r = act(g, { type: 'pave', pay: hand(1, 1) }, g.deadlineAt + offset);
    assert.equal(r.ok, false);
    assert.equal(r.code, 'TIMEOUT');
    assert.equal(g.reason, 'timeout');
    assert.equal(g.score, 0);
    assert.equal(g.endedAt, g.deadlineAt, 'endedAt stays at the deadline, not the late request time');
    assert.deepEqual(g.hand, handBefore, 'nothing was paid');
    assert.deepEqual(g.deck, deckBefore, 'nothing was drawn');
    assert.ok(!g.events.some(e => e.type === 'reveal'), 'no reveal');
  }
});

test('abandon, lifecycle and hint usage never override an expired game', () => {
  const g = game({ decks: [deck('HHVVB')] });
  routeRecordLifecycle(g, 'hidden', T0 + 10);
  routeRecordLifecycle(g, 'hint_shown', T0 + 11);
  assert.equal(g.turn, 0);
  routeAbandon(g, g.deadlineAt + 1);
  assert.equal(g.reason, 'timeout');
  assert.equal(g.endedAt, g.deadlineAt);

  const h = game({ decks: [deck('HHVVB')] });
  ok(h, { type: 'abandon' }, T0 + 5000);
  assert.equal(h.reason, 'abandoned');
  assert.equal(h.score, 0);
});

test('public view never exposes deck order, the gold map, the script or future maps', () => {
  const g = game({ mapIds: [2, 3], goldMapIndex: 2, decks: [deck('HHVVB'), deck('HHVVB')] });
  const v = routePublicView(g);
  const text = JSON.stringify(v);
  for (const secret of ['goldMapIndex', 'script', 'mapIds', 'decks', '"deck":[']) {
    assert.ok(!text.includes(secret), `leaked ${secret}`);
  }
  assert.ok(!('deck' in v), 'only deckCounts, never the ordered deck');
  // publicConfig.deck 是公開的牌種張數（每張地圖開始時的組成），不是順序
  assert.deepEqual(v.publicConfig.deck, { H: 4, V: 4, B: 2, X: 1, R: 5 });
  assert.deepEqual(Object.keys(v.deckCounts), ['H', 'V', 'B', 'X', 'R']);
  assert.equal(v.deckRemaining, 11);
  assert.equal(v.mapIndex, 1);
  assert.equal(v.mapId, 2);
  assert.deepEqual(v.position, { kind: 'first', index: 0 });
});
