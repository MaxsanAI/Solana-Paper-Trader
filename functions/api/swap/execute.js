const JUPITER_ORIGIN = "https://api.jup.ag";
const HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer"
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: HEADERS });
}

export async function onRequestPost({ request, env }) {
  const url = new URL(request.url);
  const origin = request.headers.get("origin");
  if (origin && origin !== url.origin) {
    return json({ ok: false, error: "Cross-origin swap requests are not allowed." }, 403);
  }
  if (!env.JUPITER_API_KEY) {
    return json({ ok: false, error: "Live swaps are not configured yet. Add JUPITER_API_KEY as a Cloudflare Pages secret." }, 503);
  }

  let input;
  try { input = await request.json(); } catch { return json({ ok: false, error: "Invalid JSON request." }, 400); }
  const signedTransaction = input?.signedTransaction;
  const requestId = input?.requestId;
  if (typeof signedTransaction !== "string" || signedTransaction.length < 100 || signedTransaction.length > 500000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(signedTransaction)) {
    return json({ ok: false, error: "Invalid signed transaction payload." }, 400);
  }
  if (typeof requestId !== "string" || requestId.length < 1 || requestId.length > 160 || !/^[A-Za-z0-9_-]+$/.test(requestId)) {
    return json({ ok: false, error: "Invalid Jupiter request ID." }, 400);
  }

  let upstream;
  try {
    upstream = await fetch(JUPITER_ORIGIN + "/swap/v2/execute", {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "x-api-key": env.JUPITER_API_KEY
      },
      body: JSON.stringify({ signedTransaction, requestId }),
      redirect: "error",
      signal: AbortSignal.timeout(20000)
    });
  } catch {
    return json({ ok: false, error: "Jupiter execution service is temporarily unreachable. Check wallet activity before retrying." }, 502);
  }

  const body = await upstream.text();
  if (body.length > 100000) return json({ ok: false, error: "Jupiter execution response exceeded the size limit." }, 502);
  let data;
  try { data = JSON.parse(body); } catch { return json({ ok: false, error: "Jupiter returned invalid execution data." }, 502); }
  if (!upstream.ok) {
    return json({ ok: false, error: data.error || data.errorMessage || "Jupiter execution failed (HTTP " + upstream.status + ")." }, upstream.status >= 400 && upstream.status < 500 ? 400 : 502);
  }
  return json(data);
}

export function onRequest({ request, env }) {
  if (request.method !== "POST") return json({ ok: false, error: "Method not allowed." }, 405);
  return onRequestPost({ request, env });
}
