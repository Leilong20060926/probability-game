import { ApiError } from './errors.js';

const MAX_BODY_BYTES = 64 * 1024;

export function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];

    req.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new ApiError(413, 'PAYLOAD_TOO_LARGE', '請求內容過大'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      if (!chunks.length) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new ApiError(400, 'BAD_REQUEST', 'JSON 格式錯誤'));
      }
    });

    req.on('error', reject);
  });
}

export function sendJson(res, status, body, headers = {}) {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(text);
}

export function sendText(res, status, body, contentType) {
  res.writeHead(status, {
    'Content-Type': contentType,
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

export function matchRoute(routes, method, pathname) {
  for (const route of routes) {
    if (route.method !== method) continue;

    const match = route.pattern.exec(pathname);
    if (match) {
      return { handler: route.handler, params: match.groups || {} };
    }
  }

  return null;
}

export function getQuery(req) {
  return new URL(req.url, 'http://internal').searchParams;
}

export function routePattern(path) {
  const source = path.replace(/:([A-Za-z]+)/g, (_, name) => `(?<${name}>[^/]+)`);
  return new RegExp(`^${source}$`);
}
