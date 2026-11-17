// 精確分析／提示的快取。正式設定在伺服器開始 listen 前預熱（約 1.5 秒），
// 之後所有可到達狀態都已在記憶化表中，提示查詢只是查表，不會卡住事件迴圈。
// cache 以 configId 為鍵，不同設定絕不共用。

import { makeRouteConfig, solverState } from './engine-adapter.js';
import { RouteSolver, analyze, serializeAnalysis, hintsForState, DEFAULT_TIE_ORDER } from '../../shared/route-analysis.js';

const solvers = new Map();
const analyses = new Map();

export function formalRouteConfig() {
  return makeRouteConfig();
}

export function warmRouteAnalysis(config = formalRouteConfig()) {
  if (analyses.has(config.configId)) return analyses.get(config.configId);
  const solver = new RouteSolver(config, { tieOrder: DEFAULT_TIE_ORDER });
  const result = serializeAnalysis(analyze(config, { solver }));
  solvers.set(config.configId, solver);
  analyses.set(config.configId, result);
  return result;
}

export function isWarm(configId) {
  return solvers.has(configId);
}

export function getAnalysis(configId) {
  return analyses.get(configId) ?? null;
}

// 該局目前安全狀態的每個合法動作 Q 值；只用公開資訊（手牌、牌庫各類張數、a、位置）。
export function hintsForGame(game) {
  // 正式設定在 main() 已預熱；未預熱（例如測試直接 createServer）時才在這裡算一次。
  // 其他設定不在請求路徑上臨時精算，回 null → 503。
  const formal = formalRouteConfig();
  if (!solvers.has(game.configId) && game.configId === formal.configId) warmRouteAnalysis(formal);
  const solver = solvers.get(game.configId);
  if (!solver) return null;
  return hintsForState(solver, solverState(game)).map(row => ({
    action: serializeAction(row.action),
    value: row.value.toJSON(),
    expectedActions: Math.round(row.expectedActions * 1e4) / 1e4,
    tieRank: row.tieRank,
    best: row.best,
  }));
}

function serializeAction(action) {
  if (action.type === 'pave' || action.type === 'dig') {
    const [H, V, B, X] = action.pay;
    return { type: action.type, pay: { H, V, B, X } };
  }
  return { ...action };
}
