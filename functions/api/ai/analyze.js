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

  const items = body.items.slice(0, 30).map((x) => ({
    symbol: String(x.symbol || "UNKNOWN").slice(0, 24),
    name: String(x.name || "").slice(0, 60),
    priceUsd: Number.isFinite(Number(x.priceUsd)) ? Number(Number(x.priceUsd).toPrecision(6)) : 0,
    score: Math.max(0, Math.min(100, Number(x.score) || 0)),
    liquidityUsd: Math.round(Math.max(0, Number(x.liquidityUsd) || 0) / 100) * 100,
    volume5mUsd: Math.round(Math.max(0, Number(x.volume5mUsd) || 0) / 10) * 10,
    volume1hUsd: Math.round(Math.max(0, Number(x.volume1hUsd) || 0) / 100) * 100,
    volume24hUsd: Math.round(Math.max(0, Number(x.volume24hUsd) || 0) / 100) * 100,
    change5mPct: Math.round((Number(x.change5mPct) || 0) * 10) / 10,
    change1hPct: Math.round((Number(x.change1hPct) || 0) * 10) / 10,
    change24hPct: Math.round((Number(x.change24hPct) || 0) * 10) / 10,
    buys5m: Math.max(0, Number(x.buys5m) || 0),
    sells5m: Math.max(0, Number(x.sells5m) || 0),
    buys1h: Math.max(0, Number(x.buys1h) || 0),
    sells1h: Math.max(0, Number(x.sells1h) || 0),
    buys24h: Math.max(0, Number(x.buys24h) || 0),
    sells24h: Math.max(0, Number(x.sells24h) || 0),
    ageMinutes: x.ageMinutes == null ? null : Math.max(0, Number(x.ageMinutes) || 0),
    decision: String(x.decision || "WATCH").slice(0, 32),
    reasons: Array.isArray(x.reasons) ? x.reasons.slice(0, 4).map((v) => String(v).slice(0, 100)) : [],
  }));

  const now = Date.now();
  const cacheKey = JSON.stringify(items);
  const cached = responseCache.get(cacheKey);
  if (cached && now - cached.time < SAME_INPUT_CACHE_MS) {
    return respond(200, { ...cached.data, cached: true });
  }

  // Avoid spending inference quota on repeated clicks/scans. Reuse the last
  // successful result while the cooldown is active instead of failing the UI.
  if (lastInferenceAt > 0 && now - lastInferenceAt < MIN_INFERENCE_INTERVAL_MS) {
    if (lastSuccessfulResponse) {
      return respond(200, { ...lastSuccessfulResponse, cached: true, note: "Reused recent analysis to conserve AI quota." });
    }
    return respond(429, {
      error: "AI cooldown active after a recent attempt. Please wait before retrying.",
      retryAfterSeconds: Math.ceil((MIN_INFERENCE_INTERVAL_MS - (now - lastInferenceAt)) / 1000),
    });
  }

  const prompt = [
    "You are a cautious Solana short-term momentum scanner, not a trading agent.",
    "The goal is to help a trader quickly shortlist tokens showing current 5-minute and 1-hour activity, not to rank only by 24-hour volume or large liquidity.",
    "Use 5m/1h price change, recent buy/sell counts, 5m/1h volume, liquidity relative to trade risk, pair age, and the supplied heuristic score.",
    "Do not treat a fixed $50,000 liquidity or $100,000 24h volume as a universal requirement. Smaller pools can be active but must be flagged for slippage and manipulation risk.",
    "Do not recommend chasing sharp spikes: flag very large 5m/1h gains, very new pairs, low recent transaction counts, weak buy pressure, or thin liquidity.",
    "Do not invent audits, holder concentration, contract safety, or future prices. Never guarantee profit.",
    "Return a short actionable scan: top 3 tokens to inspect first, exact metric reasons based only on supplied data, then red flags and why the score is not a probability of profit.",
    "This is a ranking heuristic, not financial advice. Market snapshot:",
    JSON.stringify(items),
  ].join("\n\n");

  // Start cooldown before inference so repeated failures cannot hammer the model.
  lastInferenceAt = now;
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
