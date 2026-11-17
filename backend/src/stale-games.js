import { abandon, routeAbandon, VERSION, ROUTE_VERSION } from './engine-adapter.js';
import { getGame, insertEvents, saveGame } from './games-repo.js';

// 目前每套規則各自支援的版本。過渡期 grid 與 route-v1 同時存在，必須分別比對，
// 不能只比一個 VERSION，否則會把另一套合法進行中的局誤結算。
export const CURRENT_VERSIONS = Object.freeze({ grid: VERSION, 'route-v1': ROUTE_VERSION });

const ABANDON = { grid: abandon, 'route-v1': routeAbandon };

// 伺服器啟動時呼叫一次：status=playing、但該 ruleset 的 version 不是目前版本的局，
// 不能用新規則繼續跑——逾時的判 timeout（abandon 內建先檢查），否則判 abandoned。
// games.version 保留原值，統計仍可用 version 區分新舊規則。
export function finalizeStaleVersionGames(db, currentVersions = CURRENT_VERSIONS, now = Date.now()) {
  // 相容舊呼叫：只傳一個字串時視為 grid 的版本
  if (typeof currentVersions === 'string') {
    currentVersions = { ...CURRENT_VERSIONS, grid: currentVersions };
  }

  const playing = db.prepare(
    "SELECT id, ruleset, version FROM games WHERE status = 'playing'",
  ).all();

  let count = 0;

  for (const row of playing) {
    const ruleset = row.ruleset ?? 'grid';
    if (currentVersions[ruleset] === row.version) continue;

    const game = getGame(db, row.id);
    const beforeEvents = game.events.length;
    const finalize = ABANDON[ruleset];
    if (!finalize) continue;

    finalize(game, now);
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
