import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

const root = path.resolve('frontend');
const sharedRoot = path.resolve('shared');
const sharedFiles = new Set(['route-config.js','route-engine.js','route-analysis.js','rational.js']);

const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
};

export function createFrontendServer() { return http.createServer(async (req, res) => {
  const name = new URL(
    req.url,
    'http://localhost',
  ).pathname;

  const sharedName = name.startsWith('/shared/') ? name.slice(8) : null;
  if (sharedName !== null && !sharedFiles.has(sharedName)) {
    res.writeHead(404).end('Not found'); return;
  }
  const file = sharedName !== null ? path.join(sharedRoot, sharedName) : path.resolve(
    root,
    '.' + (name === '/' ? '/index.html' : name),
  );

  if (sharedName === null && !file.startsWith(root + path.sep)) {
    res.writeHead(403).end();
    return;
  }

  try {
    const body = await readFile(file);

    res.writeHead(200, {
      'Content-Type':
        types[path.extname(file)] ||
        'application/octet-stream',
      'Cache-Control': 'no-store',
    });

    res.end(body);
  } catch {
    res.writeHead(404).end('Not found');
  }
}); }

if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  const server=createFrontendServer();
  server.listen(Number(process.env.PORT || 5173),'0.0.0.0',()=>console.log(`Frontend: http://localhost:${server.address().port}`));
}
