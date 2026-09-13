const MAX_REDIRECTS = 5;

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'access-control-allow-origin': '*'
    }
  });
}

function allowedTarget(raw, env) {
  const target = new URL(raw);
  if (!['http:', 'https:'].includes(target.protocol)) {
    throw new Error('Only HTTP and HTTPS provider URLs are supported');
  }

  const allowed = String(env.ALLOWED_STREAM_HOSTS || '')
    .split(',')
    .map(value => value.trim().toLowerCase())
    .filter(Boolean);

  if (allowed.length && !allowed.includes(target.hostname.toLowerCase())) {
    throw new Error('This provider host is not allowed');
  }

  return target;
}

async function fetchProvider(request, env, target, redirects = 0) {
  if (redirects > MAX_REDIRECTS) {
    return json(502, { error: 'Too many provider redirects' });
  }

  const headers = new Headers();
  headers.set('accept', request.headers.get('accept') || '*/*');
  headers.set('accept-language', request.headers.get('accept-language') || 'en-US,en;q=0.9');
  headers.set('user-agent', request.headers.get('user-agent') || 'TopTierPlayer/0.3');
  const range = request.headers.get('range');
  if (range) headers.set('range', range);

  const upstream = await fetch(target.toString(), {
    method: 'GET',
    headers,
    redirect: 'manual'
  });

  if ([301, 302, 303, 307, 308].includes(upstream.status)) {
    const location = upstream.headers.get('location');
    if (!location) return json(502, { error: 'Provider redirect had no destination' });
    return fetchProvider(request, env, allowedTarget(new URL(location, target).toString(), env), redirects + 1);
  }

  const responseHeaders = new Headers(upstream.headers);
  responseHeaders.set('access-control-allow-origin', '*');
  responseHeaders.set('cache-control', 'no-store');
  responseHeaders.delete('content-security-policy');
  responseHeaders.delete('x-frame-options');

  return new Response(upstream.body, {
    status: upstream.status,
    headers: responseHeaders
  });
}

export async function onRequestGet(context) {
  try {
    const requestUrl = new URL(context.request.url);
    const raw = requestUrl.searchParams.get('url');
    if (!raw) return json(400, { error: 'Missing provider URL' });
    return await fetchProvider(context.request, context.env, allowedTarget(raw, context.env));
  } catch (error) {
    return json(502, { error: error instanceof Error ? error.message : 'Provider connection failed' });
  }
}

export function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET, OPTIONS',
      'access-control-allow-headers': 'Range, Content-Type'
    }
  });
}
