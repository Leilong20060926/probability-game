import { abandon } from './engine-adapter.js';
import { getGame, insertEvents, saveGame } from './games-repo.js';

// 規則版本變更時，場上還在玩、version 不等於目前引擎版本的局，不能讓它用
// 新規則繼續跑下去——否則 games.version 標的規則跟它實際經歷的規則會對不上
// （Codex review 發現：新舊規則都標 0.1.0，統計無法用版本篩選分開）。
// 伺服器啟動時呼叫一次：把這些局收掉，逾時的仍判 timeout（abandon() 內建
// 會先檢查），否則判 abandoned。之後每次規則變更（VERSION 跟著變）都適用，
// 不是這次的一次性修補。
export function finalizeStaleVersionGames(db, currentVersion, now) {
  const stale = db.prepare(
    "SELECT id FROM games WHERE status = 'playing' AND version != ?",
  ).all(currentVersion);

  let count = 0;

  for (const row of stale) {
    const game = getGame(db, row.id);
    const beforeEvents = game.events.length;

    abandon(game, now);
    game.revision += 1;

    db.exec('BEGIN');
    try {
      insertEvents(db, game.id, game.events, beforeEvents);
      saveGame(db, game, now);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }

    count++;
  }

  return count;
}
