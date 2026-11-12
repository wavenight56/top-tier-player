const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const makeQr = require('qrcode-generator');
const { URL } = require('url');

const PORT = Number(process.env.PORT || 8080);
const ROOT = path.join(__dirname, 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json'
};
const PAIR_TTL_MS = 5 * 60 * 1000;
const pairings = new Map();

function json(res, status, value, extraHeaders = {}) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'Content-Type, X-Pair-Token',
    ...extraHeaders
  });
  res.end(status === 204 ? '' : JSON.stringify(value));
}

function cleanupPairings() {
  const now = Date.now();
  for (const [token, session] of pairings) if (session.expiresAt <= now) pairings.delete(token);
}

function readJson(req, limit = 8192) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', chunk => {
      body += chunk;
      if (body.length > limit) { reject(new Error('Request is too large')); req.destroy(); }
    });
    req.on('end', () => {
      try { resolve(JSON.parse(body || '{}')); }
      catch { reject(new Error('Invalid request body')); }
    });
    req.on('error', reject);
  });
}

function validProfile(profile) {
  if (!profile || !['xtream', 'm3u'].includes(profile.type)) return false;
  const values = profile.type === 'xtream'
    ? [profile.base, profile.username, profile.password]
    : [profile.playlist];
  return values.every(value => typeof value === 'string' && value.length > 0 && value.length <= 2048);
}

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

    if (requestUrl.pathname.startsWith('/api/pair/')) {
      if (req.method === 'OPTIONS') return json(res, 204, {});

      if (requestUrl.pathname === '/api/pair/new' && req.method === 'GET') {
        cleanupPairings();
        const token = crypto.randomBytes(32).toString('base64url');
        const expiresAt = Date.now() + PAIR_TTL_MS;
        pairings.set(token, { expiresAt, profile: null });
        const origin = process.env.PUBLIC_ORIGIN || `${req.headers['x-forwarded-proto'] || 'https'}://${req.headers['x-forwarded-host'] || req.headers.host}`;
        const pairUrl = `${origin}/pair.html#${token}`;
        const qr = makeQr(0, 'M');
        qr.addData(pairUrl);
        qr.make();
        return json(res, 200, { token, expiresAt, pairUrl, qrSvg: qr.createSvgTag(6, 8) });
      }

      if (requestUrl.pathname === '/api/pair/submit' && req.method === 'POST') {
        return readJson(req).then(data => {
          cleanupPairings();
          const session = pairings.get(data.token);
          if (!session) return json(res, 410, { error: 'This pairing code expired. Start again on the TV.' });
          if (session.profile) return json(res, 409, { error: 'This pairing code has already been used.' });
          if (!validProfile(data.profile)) return json(res, 400, { error: 'Enter valid provider details.' });
          session.profile = data.profile;
          return json(res, 200, { ok: true });
        }).catch(error => json(res, 400, { error: error.message || 'Invalid request.' }));
      }

      if (requestUrl.pathname === '/api/pair/poll' && req.method === 'GET') {
        cleanupPairings();
        const token = req.headers['x-pair-token'];
        const session = pairings.get(token);
        if (!session) return json(res, 410, { status: 'expired' });
        if (!session.profile) return json(res, 200, { status: 'waiting' });
        const profile = session.profile;
        pairings.delete(token);
        return json(res, 200, { status: 'ready', profile });
      }

      return json(res, 404, { error: 'Pairing endpoint not found.' });
    }

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
