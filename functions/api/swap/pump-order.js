const RPC_URL = "https://solana-rpc.publicnode.com";
const PUMPPORTAL_URL = "https://pumpportal.fun/api/trade-local";
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

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

function rawToDecimal(raw, decimals) {
  const value = BigInt(raw).toString();
  if (decimals === 0) return value;
  const padded = value.padStart(decimals + 1, "0");
  const whole = padded.slice(0, -decimals);
  const fraction = padded.slice(-decimals).replace(/0+$/, "");
  return fraction ? whole + "." + fraction : whole;
}

async function tokenDecimals(mint) {
  const response = await fetch(RPC_URL, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0", id: "paper-trader-pump-supply",
      method: "getTokenSupply", params: [mint, { commitment: "confirmed" }]
    }),
    redirect: "manual",
    signal: AbortSignal.timeout(12000)
  });
  const body = await response.text();
  let data;
  try { data = JSON.parse(body); } catch { throw new Error("Solana RPC returned invalid token-supply JSON."); }
  const decimals = data?.result?.value?.decimals;
  if (!response.ok || data?.error || !Number.isInteger(decimals) || decimals < 0 || decimals > 18) {
    throw new Error(String(data?.error?.message || "Could not read token decimals from Solana.").slice(0, 180));
  }
  return decimals;
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
      const decimals = await tokenDecimals(mint);
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
        slippage: 5,
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
      slippageBps: 500,
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
