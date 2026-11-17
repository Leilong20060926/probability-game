import { sendJson } from '../http.js';
import { formalRouteConfig, getAnalysis, warmRouteAnalysis } from '../route-analysis-service.js';

// 正式設定的唯讀精確分析。不需要 session、不含任何個人資料，所以可以公開快取；
// 個人提示走 /api/games/:id/hints（no-store）。
export function registerRouteAnalysisRoutes(routes) {
  routes.push({
    method: 'GET',
    pattern: /^\/api\/route\/analysis$/,
    handler: (req, res) => {
      const config = formalRouteConfig();
      // 正常情況伺服器啟動前已預熱；測試等未預熱時才在這裡算（約 1.5 秒）。
      const analysis = getAnalysis(config.configId) ?? warmRouteAnalysis(config);
      sendJson(res, 200, analysis, { 'Cache-Control': 'public, max-age=300' });
    },
  });
}
