const UPSTREAM_ORIGIN = "https://api.dexscreener.com";
const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer"
};

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...JSON_HEADERS, "cache-control": "no-store", ...extraHeaders }
  });
}

function allowedPath(pathname) {
  if (pathname === "/token-profiles/latest/v1") return 120;
  if (pathname === "/token-boosts/latest/v1" || pathname === "/token-boosts/top/v1") return 120;
  if (pathname === "/latest/dex/search/") return 60;
  if (/^\/latest\/dex\/tokens\/[1-9A-HJ-NP-Za-km-z,]{32,1400}$/.test(pathname)) return 15;
  return 0;
}

export async function onRequestGet(context) {
  const requestUrl = new URL(context.request.url);
  const rawPath = requestUrl.searchParams.get("path");
  if (!rawPath || rawPath.length > 1800 || !rawPath.startsWith("/") || rawPath.startsWith("//")) {
    return json({ ok: false, error: "A valid market-data path is required." }, 400);
  }

  let upstreamUrl;
  try {
    upstreamUrl = new URL(rawPath, UPSTREAM_ORIGIN);
    // Support clients that pass ?path=/latest/dex/search/ and ?q=SOL
    // separately, as well as clients that URL-encode the entire upstream path.
    if (upstreamUrl.pathname === "/latest/dex/search/" && !upstreamUrl.searchParams.has("q")) {
      const outerQuery = requestUrl.searchParams.get("q");
      if (outerQuery) upstreamUrl.searchParams.set("q", outerQuery);
    }
  } catch {
    return json({ ok: false, error: "Invalid market-data path." }, 400);
  }

  if (upstreamUrl.origin !== UPSTREAM_ORIGIN || upstreamUrl.username || upstreamUrl.password) {
    return json({ ok: false, error: "Upstream host is not allowed." }, 400);
  }

  const ttl = allowedPath(upstreamUrl.pathname);
  if (!ttl) return json({ ok: false, error: "This market-data endpoint is not allowed." }, 403);

  if (upstreamUrl.pathname === "/latest/dex/search/") {
    const query = upstreamUrl.searchParams.get("q") || "";
    if (!query || query.length > 80 || !/^[a-zA-Z0-9 ._-]+$/.test(query)) {
      return json({ ok: false, error: "Invalid search query." }, 400);
    }
  } else if (upstreamUrl.search) {
    return json({ ok: false, error: "Query parameters are not allowed for this endpoint." }, 400);
  }

  const cache = caches.default;
  const cacheKey = new Request(new URL("/api/market-cache/" + encodeURIComponent(upstreamUrl.pathname + upstreamUrl.search), requestUrl.origin), { method: "GET" });

  try {
    const cached = await cache.match(cacheKey);
    if (cached) {
      const headers = new Headers(cached.headers);
      headers.set("x-market-cache", "HIT");
      return new Response(cached.body, { status: cached.status, headers });
    }
  } catch {
    // Continue to upstream if edge cache is temporarily unavailable.
  }

  let upstream;
  try {
    upstream = await fetch(upstreamUrl.toString(), {
      method: "GET",
      headers: { accept: "application/json" },
      redirect: "follow",
      signal: AbortSignal.timeout(10000)
    });
  } catch (error) {
    return json({
      ok: false,
      error: "Market data provider is temporarily unreachable.",
      detail: String(error?.message || error || "upstream fetch failed").slice(0, 180)
    }, 502);
  }

  if (upstream.status === 429) {
    return json(
      { ok: false, error: "Market provider rate limit reached. Retry after 60 seconds.", retryAfterSeconds: 60 },
      503,
      { "retry-after": "60", "cache-control": "no-store" }
    );
  }
  if (!upstream.ok) {
    return json({ ok: false, error: "Market provider returned HTTP " + upstream.status + "." }, 502);
  }

  const contentType = upstream.headers.get("content-type") || "";
  if (!contentType.toLowerCase().includes("application/json")) {
    return json({ ok: false, error: "Market provider returned an unexpected response." }, 502);
  }

  const body = await upstream.text();
  if (body.length > 2_000_000) {
    return json({ ok: false, error: "Market provider response exceeded the size limit." }, 502);
  }

  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    return json({ ok: false, error: "Market provider returned invalid JSON." }, 502);
  }

  const response = new Response(JSON.stringify(parsed), {
    status: 200,
    headers: {
      ...JSON_HEADERS,
      "cache-control": "public, max-age=" + ttl,
      "x-market-cache": "MISS"
    }
  });

  try {
    context.waitUntil(cache.put(cacheKey, response.clone()));
  } catch {
    // Returning the live response is still useful if edge caching is unavailable.
  }
  return response;
}

export function onRequest(context) {
  if (context.request.method !== "GET") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: { allow: "GET", "cache-control": "no-store" }
    });
  }
  return onRequestGet(context);
}
