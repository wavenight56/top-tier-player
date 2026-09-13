export function onRequestGet() {
  return new Response(JSON.stringify({
    ok: true,
    service: 'top-tier-player',
    version: '0.3.0',
    httpProviders: true
  }), {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store'
    }
  });
}
