const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const PORT = Number(process.env.PORT || 8080);
const ROOT = path.join(__dirname, 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json'
};

function send(res, status, body, type = 'text/plain; charset=utf-8') {
  if (res.headersSent || res.writableEnded) return;
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(body);
}

function safeRemote(raw) {
  const target = new URL(raw);
  if (!['http:', 'https:'].includes(target.protocol)) throw new Error('Only HTTP(S) sources are supported');
  const allowed = (process.env.ALLOWED_STREAM_HOSTS || '').split(',').map(v => v.trim().toLowerCase()).filter(Boolean);
  if (allowed.length && !allowed.includes(target.hostname.toLowerCase())) throw new Error('Stream host is not allowed');
  return target;
}

function proxy(req, res, target, redirects = 0) {
  if (redirects > 5) return send(res, 502, JSON.stringify({ error: 'Too many provider redirects' }), 'application/json');

  const client = target.protocol === 'https:' ? https : http;
  const headers = {
    'user-agent': req.headers['user-agent'] || 'TopTierPlayer/0.2',
    'accept': req.headers.accept || '*/*',
    'accept-language': req.headers['accept-language'] || 'en-US,en;q=0.9'
  };
  if (req.headers.range) headers.range = req.headers.range;

  const upstream = client.request(target, { method: 'GET', headers }, response => {
    const status = response.statusCode || 502;
    const location = response.headers.location;

    if ([301, 302, 303, 307, 308].includes(status) && location) {
      response.resume();
      try {
        const next = safeRemote(new URL(location, target).toString());
        return proxy(req, res, next, redirects + 1);
      } catch (err) {
        return send(res, 502, JSON.stringify({ error: `Redirect failed: ${err.message}` }), 'application/json');
      }
    }

    const outgoing = { ...response.headers, 'access-control-allow-origin': '*', 'cache-control': 'no-store' };
    delete outgoing['content-security-policy'];
    delete outgoing['x-frame-options'];
    if (!res.headersSent) res.writeHead(status, outgoing);
    response.pipe(res);
  });

  upstream.setTimeout(30000, () => upstream.destroy(new Error('Provider timed out')));
  upstream.on('error', err => send(res, 502, JSON.stringify({ error: err.message }), 'application/json'));

  // IncomingMessage 'close' can fire after the request itself has completed.
  // Only abort the upstream request when the client actually aborts.
  req.on('aborted', () => upstream.destroy());
  upstream.end();
}

http.createServer((req, res) => {
  try {
    const requestUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

    if (requestUrl.pathname === '/api/health') {
      return send(res, 200, JSON.stringify({ ok: true, service: 'top-tier-player', version: '0.2.0' }), 'application/json');
    }

    if (requestUrl.pathname === '/api/proxy') {
      const raw = requestUrl.searchParams.get('url');
      if (!raw) return send(res, 400, JSON.stringify({ error: 'Missing url' }), 'application/json');
      return proxy(req, res, safeRemote(raw));
    }

    let relative = decodeURIComponent(requestUrl.pathname === '/' ? '/index.html' : requestUrl.pathname);
    const file = path.resolve(ROOT, '.' + relative);
    if (!file.startsWith(ROOT + path.sep)) return send(res, 403, 'Forbidden');
    fs.readFile(file, (err, data) => {
      if (err) return send(res, err.code === 'ENOENT' ? 404 : 500, 'Not found');
      const ext = path.extname(file);
      res.writeHead(200, { 'content-type': MIME[ext] || 'application/octet-stream' });
      res.end(data);
    });
  } catch (err) {
    send(res, 400, JSON.stringify({ error: err.message }), 'application/json');
  }
}).listen(PORT, () => console.log(`Top Tier Player running at http://localhost:${PORT}`));
