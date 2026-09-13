const ALLOWED_HOSTS = new Set(["streamerlax.win"]);

const corsHeaders = request => ({
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Allow-Headers":
    request.headers.get("Access-Control-Request-Headers") || "*",
  "Access-Control-Expose-Headers":
    "Content-Length, Content-Range, Accept-Ranges, Content-Type",
});

function validateTarget(rawUrl) {
  const target = new URL(rawUrl);
  if (target.protocol !== "http:" && target.protocol !== "https:") {
    throw new Error("Only HTTP and HTTPS providers are supported");
  }
  if (!ALLOWED_HOSTS.has(target.hostname.toLowerCase())) {
    throw new Error("Provider host is not allowed");
  }
  return target;
}

function json(data, status, request) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders(request),
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

export default {
  async fetch(request, env) {
    const incoming = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(request),
      });
    }

    if (incoming.pathname === "/api/health") {
      return json(
        { ok: true, service: "top-tier-player", version: "0.3.0" },
        200,
        request
      );
    }

    if (incoming.pathname === "/api/proxy") {
      const rawUrl = incoming.searchParams.get("url");
      if (!rawUrl) return json({ error: "Missing url" }, 400, request);

      try {
        const target = validateTarget(rawUrl);
        const headers = new Headers();
        headers.set("Accept", request.headers.get("Accept") || "*/*");
        headers.set(
          "User-Agent",
          request.headers.get("User-Agent") || "TopTierPlayer/0.3"
        );
        if (request.headers.has("Range")) {
          headers.set("Range", request.headers.get("Range"));
        }

        const upstream = await fetch(target.toString(), {
          method: request.method === "HEAD" ? "HEAD" : "GET",
          headers,
          redirect: "follow",
        });

        const responseHeaders = new Headers(upstream.headers);
        Object.entries(corsHeaders(request)).forEach(([key, value]) => {
          responseHeaders.set(key, value);
        });
        responseHeaders.set("Cache-Control", "no-store");
        responseHeaders.delete("Content-Security-Policy");
        responseHeaders.delete("X-Frame-Options");

        return new Response(upstream.body, {
          status: upstream.status,
          statusText: upstream.statusText,
          headers: responseHeaders,
        });
      } catch (error) {
        return json(
          { error: error.message || "Unable to connect to provider" },
          502,
          request
        );
      }
    }

    return env.ASSETS.fetch(request);
  },
};
