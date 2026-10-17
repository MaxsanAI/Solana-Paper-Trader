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

  const headers = { accept: "application/json", "x-api-key": env.JUPITER_API_KEY };
  async function requestOrder(orderParams) {
    const response = await fetch(JUPITER_ORIGIN + "/swap/v2/order?" + orderParams.toString(), {
      headers,
      redirect: "follow",
      signal: AbortSignal.timeout(25000)
    });
    const body = await response.text();
    if (body.length > 500000) throw new Error("Jupiter response exceeded the size limit.");
    let data;
    try { data = JSON.parse(body); } catch { throw new Error("Jupiter returned invalid JSON."); }
    return { response, data };
  }

  let upstream, data;
  try {
    const params = new URLSearchParams({ inputMint, outputMint, amount, taker });
    ({ response: upstream, data } = await requestOrder(params));

    // Jupiter can reject tiny orders with aggregator errorCode 3 because the
    // automatic gasless path has a minimum trade size. Retry once in manual
    // mode with explicit slippage so the connected wallet can pay network fees.
    // The transaction is still unsigned until the wallet explicitly approves it.
    if (upstream.ok && typeof data.transaction === "string" && data.transaction === "" &&
        Number(data.errorCode) === 3 && ["metis", "dflow", "okx"].includes(String(data.router || "").toLowerCase())) {
      const manualParams = new URLSearchParams({ inputMint, outputMint, amount, taker, slippageBps: "100" });
      const manual = await requestOrder(manualParams);
      upstream = manual.response;
      data = manual.data;
      if (upstream.ok && typeof data.transaction === "string" && data.transaction && typeof data.requestId === "string") {
        data.manualFeeFallback = true;
        data.manualFeeFallbackNote = "Gasless minimum was not met. This order uses 1% slippage and requires the connected wallet to pay network fees. Review the quote and available SOL before signing.";
      }
    }
  } catch (error) {
    const diagnostic = String(error?.message || error?.name || "network request failed").slice(0, 180);
    return json({ ok: false, error: "Jupiter order service could not be reached.", diagnostic }, 502);
  }

  if (!upstream.ok) {
    return json({
      ok: false,
      error: data.error || data.errorMessage || "Jupiter order request failed (HTTP " + upstream.status + ").",
      errorCode: data.errorCode ?? null,
      router: data.router ?? null
    }, upstream.status >= 400 && upstream.status < 500 ? 400 : 502);
  }
  if (typeof data.transaction !== "string" || typeof data.requestId !== "string" || !data.transaction) {
    const gaslessMinimum = Number(data.errorCode) === 3 && ["metis", "dflow", "okx"].includes(String(data.router || "").toLowerCase());
    return json({
      ok: false,
      error: data.errorMessage || (gaslessMinimum
        ? "Jupiter rejected this small order for gasless execution, and a normal wallet-paid order was not available. Check SOL for transaction fees and token-account rent, or increase the trade amount."
        : "Jupiter did not return a signable order."),
      errorCode: data.errorCode ?? null,
      router: data.router ?? null,
      manualFeeFallbackTried: gaslessMinimum
    }, 502);
  }
  return json(data);
}

export function onRequest(context) {
  if (context.request.method !== "GET") return json({ ok: false, error: "Method not allowed." }, 405);
  return onRequestGet(context);
}
