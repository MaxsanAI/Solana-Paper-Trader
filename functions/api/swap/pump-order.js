const RPC_URL = "https://solana-rpc.publicnode.com";
const PUMPPORTAL_URL = "https://pumpportal.fun/api/trade-local";
const SOL_MINT = "So11111111111111111111111111111111111111112";
const PUMP_SLIPPAGE_PERCENT = 10;
const PUMP_SLIPPAGE_BPS = PUMP_SLIPPAGE_PERCENT * 100;
const HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer"
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: HEADERS });
}

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

function rawToDecimal(raw, decimals) {
  const value = BigInt(raw).toString();
  if (decimals === 0) return value;
  const padded = value.padStart(decimals + 1, "0");
  const whole = padded.slice(0, -decimals);
  const fraction = padded.slice(-decimals).replace(/0+$/, "");
  return fraction ? whole + "." + fraction : whole;
}

function validDecimals(value) {
  return Number.isInteger(value) && value >= 0 && value <= 18;
}

function toBase64(bytes) {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

export async function onRequestPost({ request }) {
  const url = new URL(request.url);
  const origin = request.headers.get("origin");
  if (origin && origin !== url.origin) return json({ ok: false, error: "Cross-origin swap requests are not allowed." }, 403);

  let input;
  try { input = await request.json(); } catch { return json({ ok: false, error: "Invalid JSON request." }, 400); }

  const action = input?.action;
  const mint = String(input?.mint || "");
  const wallet = String(input?.wallet || "");
  const amount = String(input?.amount || "");
  const pool = String(input?.pool || "");
  const decimals = input?.decimals;
  if (!["buy", "sell"].includes(action)) return json({ ok: false, error: "Action must be buy or sell." }, 400);
  if (!BASE58.test(mint) || mint === SOL_MINT || !BASE58.test(wallet)) {
    return json({ ok: false, error: "Invalid token mint or internal-wallet public address." }, 400);
  }
  if (!/^[0-9]{1,30}$/.test(amount) || BigInt(amount) <= 0n) {
    return json({ ok: false, error: "Trade amount must be a positive integer in base units." }, 400);
  }
  if (!["pump", "pump-amm"].includes(pool)) {
    return json({ ok: false, error: "Only Pump.fun bonding curve and PumpSwap pools are allowed here." }, 400);
  }
  if (action === "buy" && BigInt(amount) > 250000000n) {
    return json({ ok: false, error: "The live-buy safety limit is 0.25 SOL per transaction." }, 400);
  }

  try {
    let tradeAmount;
    let denominatedInSol;
    if (action === "buy") {
      tradeAmount = rawToDecimal(amount, 9);
      denominatedInSol = "true";
    } else {
      if (!validDecimals(decimals)) {
        return json({ ok: false, error: "Missing or invalid token decimals supplied from the connected wallet token account." }, 400);
      }
      tradeAmount = rawToDecimal(amount, decimals);
      denominatedInSol = "false";
    }

    const response = await fetch(PUMPPORTAL_URL, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/octet-stream, application/json, text/plain" },
      body: JSON.stringify({
        publicKey: wallet,
        action,
        mint,
        amount: tradeAmount,
        denominatedInSol,
        slippage: PUMP_SLIPPAGE_PERCENT,
        priorityFee: 0.00005,
        pool
      }),
      redirect: "manual",
      signal: AbortSignal.timeout(20000)
    });

    const bytes = new Uint8Array(await response.arrayBuffer());
    if (!response.ok) {
      const detail = new TextDecoder().decode(bytes).replace(/\s+/g, " ").slice(0, 220);
      return json({
        ok: false,
        error: pool === "pump" ? "Pump.fun bonding-curve transaction could not be built." : "PumpSwap transaction could not be built.",
        diagnostic: detail || ("PumpPortal returned HTTP " + response.status + "."),
        pool
      }, response.status === 429 ? 429 : 502);
    }
    if (bytes.length < 100 || bytes.length > 500000) {
      const detail = new TextDecoder().decode(bytes).replace(/\s+/g, " ").slice(0, 220);
      return json({
        ok: false,
        error: "Pump transaction response was not a valid serialized transaction.",
        diagnostic: detail || "Unexpected transaction response size.",
        pool
      }, 502);
    }

    return json({
      ok: true,
      provider: pool === "pump" ? "Pump.fun bonding curve" : "PumpSwap",
      pool,
      transactions: [toBase64(bytes)],
      inputMint: action === "buy" ? SOL_MINT : mint,
      outputMint: action === "buy" ? mint : SOL_MINT,
      inputAmount: amount,
      outputAmount: null,
      slippageBps: PUMP_SLIPPAGE_BPS,
      priceImpactPct: null,
      routePlan: [{ dex: pool === "pump" ? "Pump.fun bonding curve" : "PumpSwap" }],
      quoteAt: Date.now(),
      serviceFeeBps: 50
    });
  } catch (error) {
    return json({
      ok: false,
      error: "Could not prepare a Pump transaction.",
      diagnostic: String(error?.message || error?.name || "Pump transaction request failed").slice(0, 220),
      pool
    }, 502);
  }
}

export function onRequest({ request }) {
  if (request.method !== "POST") return json({ ok: false, error: "Method not allowed." }, 405);
  return onRequestPost({ request });
}
