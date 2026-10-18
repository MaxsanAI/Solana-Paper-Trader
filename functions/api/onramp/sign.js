const HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer"
};
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: HEADERS });
const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

async function signQuery(query, secret) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(query));
  let binary = "";
  for (const byte of new Uint8Array(signature)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export async function onRequestPost({ request, env }) {
  const requestUrl = new URL(request.url);
  const origin = request.headers.get("origin");
  if (origin && origin !== requestUrl.origin) return json({ ok: false, error: "Cross-origin request denied." }, 403);

  const publicKey = String(env?.MOONPAY_PUBLIC_KEY || "").trim();
  const secretKey = String(env?.MOONPAY_SECRET_KEY || "").trim();
  if (!publicKey || !secretKey) {
    return json({
      ok: false,
      error: "MoonPay is not configured yet. Add MOONPAY_PUBLIC_KEY and MOONPAY_SECRET_KEY as Cloudflare Pages environment variables, then redeploy."
    }, 503);
  }

  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: "Invalid JSON request." }, 400); }
  const walletAddress = String(body?.walletAddress || "");
  const amountUsd = Number(body?.amountUsd);
  if (!BASE58.test(walletAddress)) return json({ ok: false, error: "Invalid Solana wallet address." }, 400);
  if (!Number.isFinite(amountUsd) || amountUsd < 20 || amountUsd > 1000) {
    return json({ ok: false, error: "Purchase amount must be between $20 and $1,000 USD." }, 400);
  }

  const params = new URLSearchParams();
  params.set("apiKey", publicKey);
  params.set("currencyCode", "sol");
  params.set("walletAddress", walletAddress);
  params.set("baseCurrencyCode", "usd");
  params.set("baseCurrencyAmount", amountUsd.toFixed(2));
  params.set("theme", "dark");
  const query = "?" + params.toString();
  const signature = await signQuery(query, secretKey);
  const isSandbox = String(env?.MOONPAY_ENV || "").toLowerCase() === "sandbox" || publicKey.startsWith("pk_test_");
  const host = isSandbox ? "https://buy-sandbox.moonpay.com" : "https://buy.moonpay.com";
  return json({ ok: true, url: host + query + "&signature=" + encodeURIComponent(signature) });
}

export function onRequest({ request, env }) {
  return request.method === "POST"
    ? onRequestPost({ request, env })
    : json({ ok: false, error: "Method not allowed." }, 405);
}
