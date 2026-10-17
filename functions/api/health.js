const json = (data, status = 200) => new Response(JSON.stringify(data, null, 2), {
  status,
  headers: {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff"
  }
});

export function onRequestGet({ env } = {}) {
  const liveTradingConfigured = Boolean(env && env.JUPITER_API_KEY);
  return json({
    ok: true,
    service: "solana-paper-trader-api",
    mode: liveTradingConfigured ? "paper-plus-wallet-signed-live-swaps" : "paper-only-until-live-swap-secret-configured",
    liveTradingEnabled: liveTradingConfigured,
    timestamp: new Date().toISOString(),
    checks: {
      functions: "ok",
      marketProxy: "configured",
      storage: "browser-localStorage",
      orderExecution: liveTradingConfigured ? "jupiter-secret-configured-wallet-signature-required" : "disabled-missing-JUPITER_API_KEY"
    }
  });
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
