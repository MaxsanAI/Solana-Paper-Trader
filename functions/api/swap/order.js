const RAYDIUM_ORIGIN = "https://transaction-v1.raydium.io";
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

async function raydiumJson(url, options) {
  const response = await fetch(url, {
    ...options,
    headers: { accept: "application/json", ...(options?.headers || {}) },
    redirect: "manual",
    signal: AbortSignal.timeout(20000)
  });
  const body = await response.text();
  if (body.length > 500000) throw new Error("Raydium response exceeded the size limit.");
  let data;
  try { data = JSON.parse(body); } catch { throw new Error("Raydium returned invalid JSON."); }
  if (!response.ok || data?.success === false) {
    const message = data?.msg || data?.message || data?.error || "Raydium swap request failed (HTTP " + response.status + ").";
    const error = new Error(String(message).slice(0, 240));
    error.status = response.status;
    throw error;
  }
  return data;
}

function validate(url) {
  const inputMint = url.searchParams.get("inputMint") || "";
  const outputMint = url.searchParams.get("outputMint") || "";
  const amount = url.searchParams.get("amount") || "";
  const taker = url.searchParams.get("taker") || "";
  const base58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
  if (!base58.test(inputMint) || !base58.test(outputMint) || inputMint === outputMint) {
    throw Object.assign(new Error("Invalid input/output token mint."), { status: 400 });
  }
  if (inputMint !== SOL_MINT && outputMint !== SOL_MINT) {
    throw Object.assign(new Error("Only SOL-to-token and token-to-SOL swaps are enabled."), { status: 400 });
  }
  if (!/^[0-9]{1,30}$/.test(amount) || BigInt(amount) <= 0n) {
    throw Object.assign(new Error("Swap amount must be a positive integer in base units."), { status: 400 });
  }
  if (inputMint === SOL_MINT && BigInt(amount) > 250000000n) {
    throw Object.assign(new Error("The initial live-buy limit is 0.25 SOL per transaction."), { status: 400 });
  }
  if (!base58.test(taker)) {
    throw Object.assign(new Error("Invalid wallet public address."), { status: 400 });
  }
  return { inputMint, outputMint, amount, taker };
}

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const origin = request.headers.get("origin");
  if (origin && origin !== url.origin) {
    return json({ ok: false, error: "Cross-origin swap requests are not allowed." }, 403);
  }

  let params;
  try { params = validate(url); } catch (error) {
    return json({ ok: false, error: error.message }, error.status || 400);
  }

  const slippageBps = 100;
  const computeUrl = new URL(RAYDIUM_ORIGIN + "/compute/swap-base-in");
  computeUrl.search = new URLSearchParams({
    inputMint: params.inputMint,
    outputMint: params.outputMint,
    amount: params.amount,
    slippageBps: String(slippageBps),
    txVersion: "V0"
  }).toString();

  try {
    const quote = await raydiumJson(computeUrl.toString());
    if (!quote?.data || !/^[0-9]+$/.test(String(quote.data.outputAmount || ""))) {
      return json({ ok: false, error: "Raydium did not return a valid swap quote.", raydiumMessage: quote?.msg || null }, 502);
    }

    const built = await raydiumJson(RAYDIUM_ORIGIN + "/transaction/swap-base-in", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        computeUnitPriceMicroLamports: "50000",
        swapResponse: quote,
        txVersion: "V0",
        wallet: params.taker,
        wrapSol: params.inputMint === SOL_MINT,
        unwrapSol: params.outputMint === SOL_MINT
      })
    });

    const transactions = Array.isArray(built?.data)
      ? built.data.map(item => item?.transaction).filter(value => typeof value === "string" && value.length > 100 && value.length <= 500000)
      : [];
    if (!transactions.length || transactions.length !== built.data.length) {
      return json({ ok: false, error: "Raydium did not return valid signable transaction data." }, 502);
    }

    return json({
      ok: true,
      provider: "Raydium",
      transactions,
      inputMint: params.inputMint,
      outputMint: params.outputMint,
      inputAmount: String(quote.data.inputAmount || params.amount),
      outputAmount: String(quote.data.outputAmount),
      minimumOutputAmount: String(quote.data.otherAmountThreshold || ""),
      slippageBps: Number(quote.data.slippageBps ?? slippageBps),
      priceImpactPct: Number(quote.data.priceImpactPct || 0),
      routePlan: Array.isArray(quote.data.routePlan) ? quote.data.routePlan.map(route => ({
        poolId: String(route.poolId || ""),
        inputMint: String(route.inputMint || ""),
        outputMint: String(route.outputMint || ""),
        feeAmount: String(route.feeAmount || ""),
        feeMint: String(route.feeMint || "")
      })) : [],
      quoteAt: Date.now()
    });
  } catch (error) {
    const raydiumDiagnostic = String(error?.message || error?.name || "Raydium request failed");
    if (/ROUTE_NOT_FOUND|no route found|route not found/i.test(raydiumDiagnostic)) {
      try {
        // Raydium may not support a route for newly launched/pump tokens.
        // Try Jupiter's aggregator before returning a route error.
        const jupiterBase = env?.JUPITER_API_KEY
          ? "https://api.jup.ag/swap/v1"
          : "https://lite-api.jup.ag/swap/v1";
        const jupiterHeaders = { accept: "application/json" };
        if (env?.JUPITER_API_KEY) jupiterHeaders["x-api-key"] = String(env.JUPITER_API_KEY);
        const quoteUrl = new URL(jupiterBase + "/quote");
        quoteUrl.search = new URLSearchParams({
          inputMint: params.inputMint,
          outputMint: params.outputMint,
          amount: params.amount,
          slippageBps: String(slippageBps),
          swapMode: "ExactIn",
          instructionVersion: "V2"
        }).toString();
        const quoteResponse = await fetch(quoteUrl.toString(), {
          headers: jupiterHeaders,
          redirect: "manual",
          signal: AbortSignal.timeout(20000)
        });
        const quoteText = await quoteResponse.text();
        if (quoteText.length > 500000) throw new Error("Jupiter quote response exceeded the size limit.");
        let quote;
        try { quote = JSON.parse(quoteText); } catch { throw new Error("Jupiter returned invalid quote JSON (HTTP " + quoteResponse.status + ")."); }
        if (!quoteResponse.ok || quote?.error || !/^[0-9]+$/.test(String(quote?.outAmount || ""))) {
          throw new Error(String(quote?.error || quote?.message || "Jupiter found no usable route (HTTP " + quoteResponse.status + ").").slice(0, 220));
        }

        const buildResponse = await fetch(jupiterBase + "/swap", {
          method: "POST",
          headers: { ...jupiterHeaders, "content-type": "application/json" },
          body: JSON.stringify({
            quoteResponse: quote,
            userPublicKey: params.taker,
            wrapAndUnwrapSol: true,
            dynamicComputeUnitLimit: true,
            prioritizationFeeLamports: {
              priorityLevelWithMaxLamports: { priorityLevel: "high", maxLamports: 100000 }
            }
          }),
          redirect: "manual",
          signal: AbortSignal.timeout(20000)
        });
        const buildText = await buildResponse.text();
        if (buildText.length > 500000) throw new Error("Jupiter transaction response exceeded the size limit.");
        let built;
        try { built = JSON.parse(buildText); } catch { throw new Error("Jupiter returned invalid transaction JSON (HTTP " + buildResponse.status + ")."); }
        if (!buildResponse.ok || typeof built?.swapTransaction !== "string" || built.swapTransaction.length < 100) {
          throw new Error(String(built?.error || built?.message || "Jupiter could not build a swap transaction (HTTP " + buildResponse.status + ").").slice(0, 220));
        }

        return json({
          ok: true,
          provider: "Jupiter",
          transactions: [built.swapTransaction],
          inputMint: params.inputMint,
          outputMint: params.outputMint,
          inputAmount: String(quote.inAmount || params.amount),
          outputAmount: String(quote.outAmount),
          minimumOutputAmount: String(quote.otherAmountThreshold || ""),
          slippageBps: Number(quote.slippageBps ?? slippageBps),
          priceImpactPct: Number(quote.priceImpactPct || 0),
          routePlan: Array.isArray(quote.routePlan) ? quote.routePlan.map(route => ({
            poolId: String(route.swapInfo?.ammKey || ""),
            inputMint: String(route.swapInfo?.inputMint || ""),
            outputMint: String(route.swapInfo?.outputMint || ""),
            feeAmount: String(route.swapInfo?.feeAmount || ""),
            feeMint: String(route.swapInfo?.feeMint || ""),
            dex: String(route.swapInfo?.label || "")
          })) : [],
          quoteAt: Date.now()
        });
      } catch (jupiterError) {
        const status = jupiterError.status === 400 || jupiterError.status === 429 ? jupiterError.status : 502;
        return json({
          ok: false,
          error: "No usable swap route was found on Raydium or Jupiter.",
          diagnostic: "Raydium: " + raydiumDiagnostic.slice(0, 100) + " | Jupiter: " + String(jupiterError?.message || jupiterError?.name || "request failed").slice(0, 140)
        }, status);
      }
    }
    const status = error.status === 400 || error.status === 429 ? error.status : 502;
    return json({
      ok: false,
      error: "Raydium could not prepare this swap.",
      diagnostic: raydiumDiagnostic.slice(0, 220)
    }, status);
  }
}

export function onRequest(context) {
  if (context.request.method !== "GET") return json({ ok: false, error: "Method not allowed." }, 405);
  return onRequestGet(context);
}
