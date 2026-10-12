const json = (data, status = 200) => new Response(JSON.stringify(data, null, 2), {
  status,
  headers: {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff"
  }
});

export function onRequestGet() {
  return json({
    ok: true,
    service: "solana-paper-trader-api",
    mode: "paper-only",
    liveTradingEnabled: false,
    timestamp: new Date().toISOString(),
    checks: {
      functions: "ok",
      marketProxy: "configured",
      storage: "browser-localStorage",
      orderExecution: "disabled"
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
