const MODEL = "@cf/meta/llama-3.1-8b-instruct-fast";
// Keep Workers AI usage predictable: one inference per isolate every 15 minutes.
// Calls during the cooldown reuse the most recent successful answer.
const MIN_INFERENCE_INTERVAL_MS = 15 * 60 * 1000;
const SAME_INPUT_CACHE_MS = 30 * 60 * 1000;
let lastInferenceAt = 0;
let lastSuccessfulResponse = null;
const responseCache = new Map();

export async function onRequestPost({ request, env }) {
  const headers = {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  };
  const respond = (status, body) => new Response(JSON.stringify(body), { status, headers });

  if (!env.AI || typeof env.AI.run !== "function") {
    return respond(503, {
      error: "Cloudflare Workers AI binding is not configured. Add an AI binding named AI in Pages settings.",
    });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return respond(400, { error: "Request body must be valid JSON." });
  }
  if (!Array.isArray(body?.items) || body.items.length === 0) {
    return respond(400, { error: "Provide at least one market-scan item." });
  }

  const items = body.items.slice(0, 12).map((x) => ({
    symbol: String(x.symbol || "UNKNOWN").slice(0, 24),
    priceUsd: Number.isFinite(Number(x.priceUsd)) ? Number(Number(x.priceUsd).toPrecision(6)) : 0,
    score: Math.max(0, Math.min(100, Number(x.score) || 0)),
    liquidityUsd: Math.round(Math.max(0, Number(x.liquidityUsd) || 0) / 100) * 100,
    volume24hUsd: Math.round(Math.max(0, Number(x.volume24hUsd) || 0) / 100) * 100,
    change24hPct: Math.round((Number(x.change24hPct) || 0) * 10) / 10,
    buys24h: Math.max(0, Number(x.buys24h) || 0),
    sells24h: Math.max(0, Number(x.sells24h) || 0),
    ageHours: Math.max(0, Number(x.ageHours) || 0),
    decision: String(x.decision || "WATCH").slice(0, 24),
    reasons: Array.isArray(x.reasons) ? x.reasons.slice(0, 3).map((v) => String(v).slice(0, 90)) : [],
  }));

  const now = Date.now();
  const cacheKey = JSON.stringify(items);
  const cached = responseCache.get(cacheKey);
  if (cached && now - cached.time < SAME_INPUT_CACHE_MS) {
    return respond(200, { ...cached.data, cached: true });
  }

  // Avoid spending inference quota on repeated clicks/scans. Reuse the last
  // successful result while the cooldown is active instead of failing the UI.
  if (lastSuccessfulResponse && now - lastInferenceAt < MIN_INFERENCE_INTERVAL_MS) {
    return respond(200, { ...lastSuccessfulResponse, cached: true, note: "Reused recent analysis to conserve AI quota." });
  }

  const prompt = [
    "You are a cautious Solana token market research assistant, not a trading agent.",
    "Analyze only supplied public market metrics. Do not invent audits, holder concentration, or future prices.",
    "Never guarantee profit. Flag thin liquidity, extreme volatility, negative momentum, and buy/sell imbalance when visible.",
    "Give a concise overview, at most 3 tokens for further manual research and why, plus at least 2 risks or data limitations.",
    "Treat rule-based scores as heuristics, not probabilities of profit. This is not financial advice.",
    "Return concise plain-text Markdown. Market snapshot:",
    JSON.stringify(items),
  ].join("\n\n");

  try {
    const result = await env.AI.run(MODEL, {
      messages: [
        { role: "system", content: "Be skeptical, evidence-bound, and concise. Do not predict prices or guarantee returns." },
        { role: "user", content: prompt },
      ],
      max_tokens: 450,
      temperature: 0.2,
    });
    const analysis = String(result?.response || result?.output_text || "").trim();
    if (!analysis) return respond(502, { error: "AI returned an empty analysis. Please try again later." });

    const data = {
      analysis,
      model: MODEL,
      itemsAnalyzed: items.length,
      generatedAt: new Date().toISOString(),
      cached: false,
    };
    lastInferenceAt = now;
    lastSuccessfulResponse = data;
    responseCache.set(cacheKey, { time: now, data });
    if (responseCache.size > 24) {
      const oldestKey = responseCache.keys().next().value;
      responseCache.delete(oldestKey);
    }
    return respond(200, data);
  } catch (error) {
    return respond(502, {
      error: "Workers AI request failed. Check the AI binding and available model quota.",
      detail: String(error?.message || error).slice(0, 180),
    });
  }
}
