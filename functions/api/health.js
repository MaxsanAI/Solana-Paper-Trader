const json = (data, status = 200) => new Response(JSON.stringify(data, null, 2), {
  status,
  headers: {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff"
  }
});

export function onRequestGet({ env } = {}) {
  const liveTradingConfigured = true; // Raydium Trade API + public Solana RPC; no Jupiter API key required.
  const customRpcConfigured = Boolean(env && env.SOLANA_RPC_URL);
  const liveDatabaseConfigured = Boolean(env && env.LIVE_DB && typeof env.LIVE_DB.prepare === "function");
  return json({
    ok: true,
    service: "solana-paper-trader-api",
    mode: "paper-plus-raydium-wallet-signed-live-swaps",
    liveTradingEnabled: liveTradingConfigured,
    swapProvider: "Raydium Trade API",
    solanaRpcConfigured: customRpcConfigured,
    liveDatabaseConfigured,
    workersAiConfigured: Boolean(env && env.AI && typeof env.AI.run === "function"),
    workersAiModel: "@cf/meta/llama-3.1-8b-instruct-fast",
    timestamp: new Date().toISOString(),
    checks: {
      functions: "ok",
      marketProxy: "configured; upstream availability tested by /api/market",
      workersAI: env && env.AI && typeof env.AI.run === "function" ? "binding-AI-configured" : "missing-binding-AI",
      liveStorage: liveDatabaseConfigured ? "D1-LIVE_DB-configured" : "missing-D1-LIVE_DB-binding",
      simulatorStorage: "browser-localStorage-independent",
      orderExecution: "raydium-trade-api-and-solana-rpc-wallet-signature-required",
      solanaRpc: customRpcConfigured ? "custom-SOLANA_RPC_URL-configured" : "using-public-solana-mainnet-rpc"
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
