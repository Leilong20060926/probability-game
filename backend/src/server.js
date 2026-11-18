import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { openDb } from './db.js';
import { sendJson } from './http.js';
import { ApiError } from './errors.js';
import { finalizeStaleVersionGames } from './stale-games.js';
import { warmRouteAnalysis } from './route-analysis-service.js';
import { registerPlayerRoutes } from './routes/players.js';
import { registerGameRoutes } from './routes/games.js';
import { registerAdminRoutes } from './routes/admin.js';
import { registerRouteAnalysisRoutes } from './routes/route-analysis.js';

import { registerFeedbackRoutes } from './feedback.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const frontendRoot = path.resolve(here, '..', '..', 'frontend');
const sharedRoot = path.resolve(here, '..', '..', 'shared');

// /shared/* 只提供這幾個純共用模組；不能順便暴露 backend、資料庫或環境檔。
export const SHARED_MODULES = new Set([
  'rational.js',
  'route-config.js',
  'route-engine.js',
  'route-analysis.js',
]);

const staticTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
};

export function createServer(db) {
  const routes = [];
  registerPlayerRoutes(routes, db);
  registerGameRoutes(routes, db);
  registerAdminRoutes(routes, db);
  registerRouteAnalysisRoutes(routes);
  registerFeedbackRoutes(routes, db);


  return http.createServer(async (req, res) => {
    const pathname = new URL(req.url, 'http://internal').pathname;

    if (pathname.startsWith('/api/')) {
      await dispatchApi(routes, req, res, pathname);
      return;
    }

    if (pathname.startsWith('/shared/')) {
      await serveShared(res, pathname);
      return;
    }

    await serveStatic(req, res, pathname);
  });
}

async function serveShared(res, pathname) {
  const name = pathname.slice('/shared/'.length);
  if (!SHARED_MODULES.has(name)) {
    res.writeHead(404).end('Not found');
    return;
  }
  const body = await readFile(path.join(sharedRoot, name));
  res.writeHead(200, {
    'Content-Type': 'text/javascript; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

async function dispatchApi(routes, req, res, pathname) {
  const route = routes.find(r => r.method === req.method && r.pattern.test(pathname));

  if (!route) {
    sendJson(res, 404, { error: { code: 'NOT_FOUND', message: '找不到這個 API' } });
    return;
  }

  try {
    const match = route.pattern.exec(pathname);
    await route.handler(req, res, match.groups || {});
  } catch (err) {
    if (err instanceof ApiError) {
      sendJson(res, err.status, err.toJSON());
      return;
    }

    console.error(err);
    sendJson(res, 500, { error: { code: 'INTERNAL_ERROR', message: '伺服器內部錯誤' } });
  }
}

async function serveStatic(req, res, pathname) {
  const name = pathname === '/' ? '/index.html' : pathname;
  const file = path.resolve(frontendRoot, '.' + name);

  if (!file.startsWith(frontendRoot + path.sep) && file !== frontendRoot) {
    res.writeHead(403).end();
    return;
  }

  try {
    const body = await readFile(file);
    res.writeHead(200, {
      'Content-Type': staticTypes[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end(body);
  } catch {
    res.writeHead(404).end('Not found');
  }
}

function main() {
  try {
    process.loadEnvFile(path.resolve(here, '..', '.env'));
  } catch {
    // 沒有 .env 時使用環境變數或預設值。
  }

  const dbPath = process.env.DB_PATH || 'backend/data/game.db';
  const db = openDb(dbPath);
  const port = Number(process.env.PORT || 5174);

  const finalized = finalizeStaleVersionGames(db, undefined, Date.now());
  if (finalized) {
    console.log(`Finalized ${finalized} in-progress game(s) left over from a previous rules version.`);
  }

  // 開始 listen 前預熱正式設定的精確分析，之後提示查詢都是查表。
  const t0 = performance.now();
  const analysis = warmRouteAnalysis();
  console.log(`route-v1 exact analysis ready (${analysis.configId}, ${Math.round(performance.now() - t0)} ms)`);

  createServer(db).listen(port, '0.0.0.0', () => {
    console.log(`Backend (+static frontend): http://localhost:${port}`);
    console.log(`DB: ${dbPath}`);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
