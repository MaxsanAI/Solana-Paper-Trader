const DEFAULT_RPC = "https://api.mainnet-beta.solana.com";
// Alternate official mainnet RPC hostname. Used only after an explicit access-denied
// response; never fail over on timeouts or other ambiguous transaction-submission errors.
const ALTERNATE_RPC = "https://api.mainnet.solana.com";
const PUBLICNODE_RPC = "https://solana-rpc.publicnode.com";
const HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer"
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: HEADERS });
}

async function rpcCall(rpcUrl, method, params) {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "solana-paper-trader", method, params }),
    redirect: "manual",
    signal: AbortSignal.timeout(12000)
  });
  const body = await response.text();
  if (body.length > 200000) throw new Error("Solana RPC response exceeded the size limit.");
  let data;
  try { data = JSON.parse(body); } catch { throw new Error("Solana RPC returned invalid JSON."); }
  if (!response.ok || data.error) {
    const detail = data?.error?.data && typeof data.error.data === "object"
      ? JSON.stringify(data.error.data).slice(0, 140)
      : "";
    throw new Error(String(data?.error?.message || "Solana RPC request failed (HTTP " + response.status + ").")
      .concat(detail ? " | " + detail : "")
      .slice(0, 220));
  }
  return data.result;
}

function isProviderAccessError(error) {
  return /blocked from this endpoint|access forbidden|indexed requests require a personal token|HTTP 403|\b403\b/i
    .test(String(error?.message || error || ""));
}

async function rpcCallWithFallback(primaryUrl, method, params) {
  try {
    return await rpcCall(primaryUrl, method, params);
  } catch (primaryError) {
    // Fail over only on explicit HTTP/provider access denial. Never replay after
    // timeout, connection reset, or other ambiguous sendTransaction errors.
    if (!isProviderAccessError(primaryError)) throw primaryError;

    const candidates = [...new Set([PUBLICNODE_RPC, DEFAULT_RPC, ALTERNATE_RPC])]
      .filter(candidate => candidate !== primaryUrl);
    const failures = [String(primaryError?.message || "provider access denied").slice(0, 70)];

    for (const candidate of candidates) {
      try {
        return await rpcCall(candidate, method, params);
      } catch (fallbackError) {
        failures.push(candidate + ": " + String(fallbackError?.message || "RPC error").slice(0, 70));
        // An explicit access denial is safe to fail over from; other errors may
        // mean a transaction submission had an uncertain outcome, so stop here.
        if (!isProviderAccessError(fallbackError)) break;
      }
    }
    throw new Error("Solana RPC access denied; fallback attempts: " + failures.join(" | ").slice(0, 200));
  }
}

async function waitForConfirmation(rpcUrl, signature) {
  for (let attempt = 0; attempt < 12; attempt++) {
    const result = await rpcCallWithFallback(rpcUrl, "getSignatureStatuses", [[signature], { searchTransactionHistory: true }]);
    const status = result?.value?.[0];
    if (status?.err) {
      throw new Error("Solana rejected the transaction: " + JSON.stringify(status.err).slice(0, 220));
    }
    if (status && ["confirmed", "finalized"].includes(status.confirmationStatus)) {
      return status.confirmationStatus;
    }
    await new Promise(resolve => setTimeout(resolve, 700));
  }
  return "pending";
}

export async function onRequestPost({ request, env }) {
  const url = new URL(request.url);
  const origin = request.headers.get("origin");
  if (origin && origin !== url.origin) {
    return json({ ok: false, error: "Cross-origin swap requests are not allowed." }, 403);
  }

  let input;
  try { input = await request.json(); } catch {
    return json({ ok: false, error: "Invalid JSON request." }, 400);
  }

  const signedTransactions = input?.signedTransactions;
  if (!Array.isArray(signedTransactions) || signedTransactions.length < 1 || signedTransactions.length > 5 ||
      signedTransactions.some(value => typeof value !== "string" || value.length < 100 || value.length > 500000 ||
        !/^[A-Za-z0-9+/]+={0,2}$/.test(value))) {
    return json({ ok: false, error: "Invalid signed transaction list." }, 400);
  }
  const outputAmount = typeof input?.outputAmount === "string" && /^[0-9]{1,30}$/.test(input.outputAmount)
    ? input.outputAmount : null;

  let rpcUrl = String(env?.SOLANA_RPC_URL || DEFAULT_RPC);
  try {
    const parsed = new URL(rpcUrl);
    if (parsed.protocol !== "https:" || !parsed.hostname) throw new Error("RPC URL must use HTTPS.");
  } catch {
    return json({ ok: false, error: "SOLANA_RPC_URL must be a valid HTTPS Solana RPC URL." }, 503);
  }

  const signatures = [];
  for (let index = 0; index < signedTransactions.length; index++) {
    const signedTransaction = signedTransactions[index];
    let signature;
    try {
      signature = await rpcCallWithFallback(rpcUrl, "sendTransaction", [signedTransaction, {
        encoding: "base64",
        skipPreflight: false,
        preflightCommitment: "confirmed",
        maxRetries: 2
      }]);
    } catch (error) {
      return json({
        ok: false,
        status: "Failed",
        error: "Solana rejected or could not submit transaction " + (index + 1) + ". Check the RPC detail below; if the result is uncertain, check wallet activity before retrying.",
        diagnostic: String(error?.message || "RPC send failed").slice(0, 220),
        signatures
      }, 502);
    }

    if (typeof signature !== "string" || signature.length < 32 || signature.length > 100) {
      return json({ ok: false, status: "Failed", error: "Solana RPC returned an invalid transaction signature.", signatures }, 502);
    }
    signatures.push(signature);

    let confirmation;
    try {
      confirmation = await waitForConfirmation(rpcUrl, signature);
    } catch (error) {
      return json({
        ok: false,
        status: "Failed",
        error: "Transaction " + (index + 1) + " was submitted but confirmation checking failed. Check wallet activity before retrying.",
        diagnostic: String(error?.message || "Confirmation failed").slice(0, 220),
        signature,
        signatures
      }, 502);
    }

    if (confirmation === "pending") {
      return json({
        ok: true,
        status: "Pending",
        signature,
        signatures,
        outputAmount,
        error: "The transaction was submitted but confirmation is still pending. Check the signature before attempting another swap."
      });
    }
  }

  return json({
    ok: true,
    status: "Success",
    provider: "Raydium",
    signature: signatures[signatures.length - 1],
    signatures,
    outputAmount
  });
}

export function onRequest({ request, env }) {
  if (request.method !== "POST") return json({ ok: false, error: "Method not allowed." }, 405);
  return onRequestPost({ request, env });
}
