import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve('frontend');

const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
};

http.createServer(async (req, res) => {
  const name = new URL(
    req.url,
    'http://localhost',
  ).pathname;

  const file = path.resolve(
    root,
    '.' + (name === '/' ? '/index.html' : name),
  );

  if (!file.startsWith(root + path.sep)) {
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
}).listen(
  Number(process.env.PORT || 5173),
  '0.0.0.0',
  () => console.log(
    `Frontend: http://localhost:${process.env.PORT || 5173}`,
  ),
);