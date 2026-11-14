import { createServer } from '../src/server.js';
import { openDb } from '../src/db.js';

export function startTestServer() {
  const db = openDb(':memory:');
  const server = createServer(db);

  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        db,
        server,
        baseUrl: `http://127.0.0.1:${port}`,
        close: () => new Promise(r => server.close(r)),
      });
    });

    server.on('error', reject);
  });
}

export function makeClient(baseUrl) {
  const cookies = {};

  function applySetCookies(res) {
    const setCookies = res.headers.getSetCookie?.() || [];
    for (const sc of setCookies) {
      const pair = sc.split(';')[0];
      const i = pair.indexOf('=');
      if (i < 0) continue;
      cookies[pair.slice(0, i)] = pair.slice(i + 1);
    }
  }

  function cookieHeader() {
    return Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ');
  }

  async function request(method, path, body, extraHeaders = {}) {
    const res = await fetch(baseUrl + path, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookieHeader(),
        ...extraHeaders,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    applySetCookies(res);
    const text = await res.text();
    let parsed = null;

    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
    }

    return { status: res.status, body: parsed, headers: res.headers };
  }

  return {
    post: (path, body, headers) => request('POST', path, body ?? {}, headers),
    get: (path, headers) => request('GET', path, undefined, headers),
    cookies,
  };
}
