import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  CARDS,
  newGame,
  canPlace,
  reachable,
  act,
  checkTimeout,
  recordLifecycle,
  abandon,
} from '../frontend/src/engine.js';

const fresh = () => newGame(
  'player-test',
  1,
  () => 0.42,
  1000,
);

test(
  '18 roads, five starting road cards, four rocks in remaining 17 cards',
  () => {
    const g = fresh();

    assert.equal(
      CARDS.reduce((s, c) => s + c.count, 0),
      18,
    );
    assert.equal(g.hand.length, 5);
    assert.equal(g.deck.length, 17);
    assert.equal(g.hand.includes('rock'), false);
    assert.equal(
      g.deck.filter(c => c === 'rock').length,
      4,
    );

    for (const c of CARDS) {
      assert.equal(
        [...g.hand, ...g.deck]
          .filter(id => id === c.id)
          .length,
        c.count,
      );
    }
  },
);

test(
  'placement must join entrance, cannot overwrite, cannot mismatch adjacent ports',
  () => {
    const g = fresh();

    assert.equal(
      canPlace(g, 'horizontal', 2, 1),
      true,
    );
    assert.equal(
      canPlace(g, 'vertical', 2, 1),
      false,
    );
    assert.equal(
      canPlace(g, 'horizontal', 2, 3),
      false,
    );
    assert.equal(
      canPlace(g, 'cross', 2, 0),
      false,
    );

    g.board['2,1'] = 'horizontal';
    g.board['1,2'] = 'vertical';

    assert.equal(
      canPlace(g, 'horizontal', 2, 2),
      false,
    );
    assert.equal(
      canPlace(g, 'tee-up', 2, 2),
      true,
    );
  },
);

test(
  'reject illegal action without consuming card, turn or event',
  () => {
    const g = fresh();
    const original = structuredClone(g);

    assert.equal(
      act(g, 0, [0, 0], 2000),
      false,
    );

    assert.deepEqual(g, original);
  },
);

test(
  'consecutive rocks remove most recent roads and continue drawing',
  () => {
    const g = fresh();

    g.hand = ['horizontal'];
    g.deck = ['rock', 'rock', 'vertical'];
    g.board = { '2,1': 'horizontal' };
    g.placed = ['2,1'];

    assert.equal(
      act(g, 0, [2, 2], 2000),
      true,
    );

    assert.deepEqual(g.board, {});
    assert.deepEqual(g.hand, ['vertical']);

    assert.deepEqual(
      g.events
        .filter(e => e.type === 'rock')
        .map(e => e.removed),
      ['2,2', '2,1'],
    );

    assert.equal(
      g.events[0].decisionMs,
      1000,
    );
  },
);

test(
  'rock on empty board safely consumes rock and draws road',
  () => {
    const g = fresh();

    g.hand = ['vertical'];
    g.deck = ['rock', 'rock', 'horizontal'];

    act(g, 0, null, 2000);

    assert.deepEqual(
      g.hand,
      ['horizontal'],
    );
    assert.equal(
      g.events.filter(e => e.type === 'rock').length,
      2,
    );
    assert.equal(
      g.events.find(e => e.type === 'rock').removed,
      null,
    );
  },
);

test(
  'coin continues game; gold scores 60 plus prior coins and ends before drawing',
  () => {
    const g = fresh();

    g.board = {
      '2,1': 'horizontal',
      '2,2': 'horizontal',
      '2,3': 'horizontal',
    };
    g.placed = Object.keys(g.board);
    g.hand = ['tee-up'];
    g.deck = ['vertical'];
    g.goldRow = 0;

    act(g, 0, [2, 4], 2000);

    assert.equal(g.status, 'playing');
    assert.equal(g.coins, 1);
    assert.deepEqual(g.revealed, [2]);

    g.hand = ['vertical'];
    g.deck = ['bend-dr'];

    act(g, 0, [1, 4], 3000);
    act(g, 0, [0, 4], 4000);

    assert.equal(g.status, 'finished');
    assert.equal(g.reason, 'gold');
    assert.equal(g.score, 80);
    assert.equal(g.events.at(-1).type, 'end');
  },
);

test(
  'gold takes priority over deck/hand exhaustion on final road',
  () => {
    const g = fresh();

    g.goldRow = 2;
    g.deck = [];
    g.hand = ['horizontal'];
    g.board = {
      '2,1': 'horizontal',
      '2,2': 'horizontal',
      '2,3': 'horizontal',
    };

    act(g, 0, [2, 4], 2000);

    assert.equal(g.reason, 'gold');
    assert.equal(g.score, 60);
  },
);

test(
  'same-turn rockfall that disconnects the just-revealed road revokes that reveal',
  () => {
    const g = fresh();

    g.goldRow = 0;
    g.board = {
      '2,1': 'horizontal',
      '2,2': 'horizontal',
      '2,3': 'horizontal',
    };
    g.placed = Object.keys(g.board);
    g.hand = ['horizontal'];
    g.deck = ['rock', 'vertical'];

    act(g, 0, [2, 4], 2000);

    assert.equal(g.coins, 0);
    assert.deepEqual(g.revealed, []);
    assert.equal(
      reachable(g).has('2,5'),
      false,
    );
    assert.deepEqual(
      g.events.filter(e => e.type === 'unreveal'),
      [{
        seq: 5,
        turn: 1,
        type: 'unreveal',
        elapsedMs: 1000,
        row: 2,
      }],
    );
  },
);

test(
  'a reveal that survives its own turn stays permanent even if a later rockfall disconnects it',
  () => {
    const g = fresh();

    g.goldRow = 0;
    g.board = {
      '2,1': 'horizontal',
      '2,2': 'horizontal',
      '2,3': 'horizontal',
    };
    g.placed = Object.keys(g.board);
    g.hand = ['horizontal', 'vertical'];
    g.deck = ['vertical', 'rock', 'bend-dr'];

    act(g, 0, [2, 4], 2000);

    assert.equal(g.coins, 1);
    assert.deepEqual(g.revealed, [2]);

    act(g, 0, null, 3000);

    assert.equal(
      g.events.filter(e => e.type === 'rock').length,
      1,
    );
    assert.equal(
      g.coins,
      1,
      '斷線發生在不同回合，先前的翻牌不應被撤銷',
    );
    assert.deepEqual(g.revealed, [2]);
    assert.equal(
      reachable(g).has('2,5'),
      false,
    );
  },
);

test(
  'empty deck does not stop play while hand remains; final discard ends with zero',
  () => {
    const g = fresh();

    g.hand = ['vertical', 'vertical'];
    g.deck = [];
    g.coins = 2;

    act(g, 0, null, 2000);
    assert.equal(g.status, 'playing');

    act(g, 0, null, 3000);
    assert.equal(g.reason, 'exhausted');
    assert.equal(g.score, 0);
  },
);

test(
  'wall-clock timeout survives reload, rejects action, finalizes exactly once',
  () => {
    const g = JSON.parse(
      JSON.stringify(fresh()),
    );

    assert.equal(
      act(g, 0, null, 301000),
      false,
    );
    assert.equal(g.reason, 'timeout');
    assert.equal(g.endedAt, 301000);
    assert.equal(
      checkTimeout(g, 401000),
      false,
    );
    assert.equal(
      g.events.filter(e => e.type === 'end').length,
      1,
    );
  },
);

test(
  'abandon respects deadline and cannot overwrite or duplicate a final result',
  () => {
    for (const now of [300999, 301000, 301001]) {
      const g = fresh();
      const before = structuredClone(g);

      abandon(g, now);

      assert.equal(g.reason, now < 301000 ? 'abandoned' : 'timeout');
      assert.equal(g.endedAt, Math.min(now, 301000));
      assert.equal(g.score, 0);
      assert.equal(g.turn, before.turn);
      assert.deepEqual(g.hand, before.hand);
      assert.deepEqual(g.deck, before.deck);
      assert.equal(g.events.filter(e => e.type === 'end').length, 1);

      const finished = structuredClone(g);
      abandon(g, 401000);
      checkTimeout(g, 401000);
      assert.deepEqual(g, finished);
    }
  },
);

test(
  'lifecycle events preserve decision clock and abandoned sessions cannot act',
  () => {
    const g = fresh();

    recordLifecycle(g, 'hidden', 2000);
    recordLifecycle(g, 'visible', 5000);
    act(g, 0, null, 6000);

    assert.equal(
      g.events.find(e => e.type === 'discard').decisionMs,
      5000,
    );

    abandon(g, 7000);

    assert.equal(g.reason, 'abandoned');
    assert.equal(g.score, 0);
    assert.equal(
      act(g, 0, null, 8000),
      false,
    );

    recordLifecycle(g, 'restored', 9000);

    assert.equal(
      g.events.at(-1).type,
      'end',
    );
    assert.deepEqual(
      g.events.map(e => e.seq),
      g.events.map((_, i) => i + 1),
    );
  },
);

// 0.3.0 規則：第 6 欄第 2、4 列可以放牌，並可從上／下接入終點。
const pathToRow1Col4 = () => ({
  status: 'playing',
  board: {
    '2,1': 'horizontal',
    '2,2': 'horizontal',
    '2,3': 'bend-ul',
    '1,3': 'bend-dr',
    '1,4': 'horizontal',
  },
});

test('cells between targets in column 6 accept any road that fits', () => {
  const g = pathToRow1Col4();

  for (const id of ['horizontal', 'cross', 'bend-ul', 'bend-dl', 'tee-left']) {
    assert.equal(canPlace(g, id, 1, 5), true, id);
  }
  // 沒有朝左的牌接不到第 5 欄的道路
  assert.equal(canPlace(g, 'vertical', 1, 5), false);
  // 終點格本身仍不能放牌
  assert.equal(canPlace(g, 'horizontal', 0, 5), false);
});

test('a road below or above a target connects to it', () => {
  const up = pathToRow1Col4();
  up.board['1,5'] = 'bend-ul';
  assert.equal(reachable(up).has('0,5'), true);
  assert.equal(reachable(up).has('2,5'), false);

  const down = pathToRow1Col4();
  down.board['1,5'] = 'bend-dl';
  assert.equal(reachable(down).has('2,5'), true);
  assert.equal(reachable(down).has('0,5'), false);

  const both = pathToRow1Col4();
  both.board['1,5'] = 'tee-left';
  assert.equal(reachable(both).has('0,5'), true);
  assert.equal(reachable(both).has('2,5'), true);
});

test('targets are still endpoints: paths do not pass through them', () => {
  // 由左邊接到第 3 列終點，不能穿過終點走到第 2、4 列
  const g = {
    status: 'playing',
    board: {
      '2,1': 'horizontal', '2,2': 'horizontal',
      '2,3': 'horizontal', '2,4': 'horizontal',
    },
  };
  assert.equal(reachable(g).has('2,5'), true);
  assert.equal(canPlace(g, 'vertical', 1, 5), false);
  assert.equal(canPlace(g, 'cross', 3, 5), false);
});

test('reaching a coin from below reveals it during play', () => {
  const g = fresh();
  g.goldRow = 4;
  Object.assign(g.board, pathToRow1Col4().board);
  g.placed.push(...Object.keys(g.board));
  g.hand[0] = 'bend-ul';
  g.deck = ['horizontal'];

  assert.equal(act(g, 0, [1, 5], 2000), true);
  assert.deepEqual(g.revealed, [0]);
  assert.equal(g.coins, 1);
  assert.equal(g.status, 'playing');
});

test('connecting a coin and the gold in one move counts the coin too', () => {
  for (const goldRow of [0, 2]) {
    const g = fresh();
    g.goldRow = goldRow;
    Object.assign(g.board, pathToRow1Col4().board);
    g.placed.push(...Object.keys(g.board));
    g.hand[0] = 'tee-left'; // 第 6 欄第 2 列，同時接通第 1、3 列終點

    assert.equal(act(g, 0, [1, 5], 2000), true);
    assert.equal(g.status, 'finished');
    assert.equal(g.reason, 'gold');
    assert.equal(g.coins, 1, `goldRow=${goldRow}`);
    assert.equal(g.score, 80, `goldRow=${goldRow}`);
    const reveals = g.events.filter(e => e.type === 'reveal');
    assert.deepEqual(reveals.map(e => e.reward), ['coin', 'gold']);
  }
});
