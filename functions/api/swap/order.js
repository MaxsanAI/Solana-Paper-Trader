const JUPITER_ORIGIN = "https://api.jup.ag";
const SOL_MINT = "So11111111111111111111111111111111111111112";
const HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer"
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: HEADERS });
}

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const origin = request.headers.get("origin");
  if (origin && origin !== url.origin) {
    return json({ ok: false, error: "Cross-origin swap requests are not allowed." }, 403);
  }
  if (!env.JUPITER_API_KEY) {
    return json({
      ok: false,
      error: "Live swaps are not configured yet. Add JUPITER_API_KEY as a Cloudflare Pages secret, then retry."
    }, 503);
  }

  const inputMint = url.searchParams.get("inputMint") || "";
  const outputMint = url.searchParams.get("outputMint") || "";
  const amount = url.searchParams.get("amount") || "";
  const taker = url.searchParams.get("taker") || "";
  const base58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

  if (!base58.test(inputMint) || !base58.test(outputMint) || inputMint === outputMint) {
    return json({ ok: false, error: "Invalid input/output token mint." }, 400);
  }
  if (inputMint !== SOL_MINT && outputMint !== SOL_MINT) {
    return json({ ok: false, error: "Only SOL-to-token and token-to-SOL swaps are enabled." }, 400);
  }
  if (!/^[0-9]{1,30}$/.test(amount) || BigInt(amount) <= 0n) {
    return json({ ok: false, error: "Swap amount must be a positive integer in base units." }, 400);
  }
  if (inputMint === SOL_MINT && BigInt(amount) > 250000000n) {
    return json({ ok: false, error: "The initial live-buy limit is 0.25 SOL per transaction." }, 400);
  }
  if (!base58.test(taker)) {
    return json({ ok: false, error: "Invalid wallet public address." }, 400);
  }

  const params = new URLSearchParams({ inputMint, outputMint, amount, taker });
  let upstream;
  try {
    upstream = await fetch(JUPITER_ORIGIN + "/swap/v2/order?" + params.toString(), {
      headers: { accept: "application/json", "x-api-key": env.JUPITER_API_KEY },
      redirect: "error",
      signal: AbortSignal.timeout(15000)
    });
  } catch {
    return json({ ok: false, error: "Jupiter order service is temporarily unreachable." }, 502);
  }

  const body = await upstream.text();
  if (body.length > 500000) return json({ ok: false, error: "Jupiter response exceeded the size limit." }, 502);
  let data;
  try { data = JSON.parse(body); } catch { return json({ ok: false, error: "Jupiter returned invalid JSON." }, 502); }
  if (!upstream.ok) {
    return json({ ok: false, error: data.error || data.errorMessage || "Jupiter order request failed (HTTP " + upstream.status + ")." }, upstream.status >= 400 && upstream.status < 500 ? 400 : 502);
  }
  if (typeof data.transaction !== "string" || typeof data.requestId !== "string") {
    return json({ ok: false, error: data.errorMessage || "Jupiter did not return a signable order." }, 502);
  }
  return json(data);
}

export function onRequest({ request }) {
  if (request.method !== "GET") return json({ ok: false, error: "Method not allowed." }, 405);
  return onRequestGet({ request, env: arguments[0].env });
}
