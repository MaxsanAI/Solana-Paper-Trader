export async function onRequestPost({ request, env }) {
  const cors = {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  };
  const respond = (status, body) => new Response(JSON.stringify(body), { status, headers: cors });
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
  const items = body.items.slice(0, 18).map((x) => ({
    symbol: String(x.symbol || "UNKNOWN").slice(0, 24),
    priceUsd: Number(x.priceUsd) || 0,
    score: Math.max(0, Math.min(100, Number(x.score) || 0)),
    liquidityUsd: Math.max(0, Number(x.liquidityUsd) || 0),
    volume24hUsd: Math.max(0, Number(x.volume24hUsd) || 0),
    change24hPct: Number.isFinite(Number(x.change24hPct)) ? Number(x.change24hPct) : 0,
    buys24h: Math.max(0, Number(x.buys24h) || 0),
    sells24h: Math.max(0, Number(x.sells24h) || 0),
    ageHours: Math.max(0, Number(x.ageHours) || 0),
    decision: String(x.decision || "WATCH").slice(0, 24),
    reasons: Array.isArray(x.reasons) ? x.reasons.slice(0, 4).map((v) => String(v).slice(0, 100)) : [],
  }));
  const prompt = [
    "You are a cautious Solana token market research assistant, not a trading agent.",
    "Analyze only the supplied public market metrics. Do not invent facts, contract audits, holder concentration, or future prices.",
    "Never tell the user profit is guaranteed. Clearly flag thin liquidity, extreme volatility, negative momentum, and buy/sell imbalance where visible.",
    "Do not provide instructions to automatically buy. Give a concise overview, then list at most 3 tokens worth further manual research and why, and at least 2 risks or data limitations.",
    "Treat the numeric rule-based score as a heuristic, not a probability of profit. This is not financial advice.",
    "Return plain text in concise Markdown. Market snapshot:",
    JSON.stringify(items),
  ].join("\n\n");
  try {
    const result = await env.AI.run("@cf/meta/llama-3.1-8b-instruct", {
      messages: [
        { role: "system", content: "Be skeptical, evidence-bound, and concise. Do not make price predictions or guarantee returns." },
        { role: "user", content: prompt },
      ],
      max_tokens: 650,
      temperature: 0.2,
    });
    const analysis = String(result?.response || result?.output_text || "").trim();
    if (!analysis) return respond(502, { error: "AI returned an empty analysis. Please try again." });
    return respond(200, { analysis, model: "@cf/meta/llama-3.1-8b-instruct", itemsAnalyzed: items.length, generatedAt: new Date().toISOString() });
  } catch (error) {
    return respond(502, { error: "Workers AI request failed. Check the AI binding and available model quota.", detail: String(error?.message || error).slice(0, 180) });
  }
}
