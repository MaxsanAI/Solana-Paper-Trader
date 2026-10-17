# Cloudflare Pages preparation

This repository keeps the paper simulator separate and adds an opt-in live swap interface. Live swaps require Cloudflare Pages Functions plus a Jupiter API secret. These files do not deploy anything to Cloudflare by themselves.

## What is included

- `/api/health` — confirms the Functions runtime is responding and explicitly reports live trading as disabled.
- `/api/market?path=...` — same-origin proxy for a small allowlist of DexScreener market-data endpoints.
- `/api/swap/order` — validated SOL-to-token or token-to-SOL order proxy to Jupiter Swap API V2.
- `/api/swap/execute` — forwards a transaction already signed by the connected wallet to Jupiter for execution. The secret remains server-side.
- Edge response caching with endpoint-specific TTLs, request validation, response-size limits, and an explicit response when DexScreener rate-limits the request.
- The existing GitHub Pages deployment can continue using the public provider directly.

## Before a Cloudflare deployment

1. In Cloudflare Dashboard, open **Workers & Pages** and create or select a Pages project connected to this repository.
2. Ensure the project root is the repository root and the build command is empty for this plain HTML site. The Functions directory must be at the repository root.
3. Do not deploy until the owner is ready. After a deliberate deployment, test `/api/health` and `/api/market?path=%2Flatest%2Fdex%2Fsearch%2F%3Fq%3DSOL`.
4. In Cloudflare Pages **Settings → Variables and Secrets**, add a secret named `JUPITER_API_KEY` using an API key from the official Jupiter developer portal. Redeploy after adding or changing the secret. Never add this key to GitHub or browser code.
5. Check response headers for `x-market-cache: MISS` followed by `HIT` on a repeated market-data request. Cache behavior can vary by edge location.
6. The live swap page is manual only: the user signs each transaction in Phantom or Solflare. It does not implement autonomous server-side trading or a persistent bot scheduler.

## Safety boundaries

- Never put a wallet private key, seed phrase, RPC secret, or trading secret in `index.html`, browser storage, Git, or a public variable. `JUPITER_API_KEY` must be a Cloudflare Pages secret.
- The paper bot remains browser-based and runs only while the page is active. Live swaps are manual wallet-approved transactions, not automatic bot execution.
- A genuine autonomous bot would need a separately designed server-side execution service, persistent state, explicit risk limits, secret storage, transaction validation, monitoring, and a separate opt-in before any real funds could be at risk.
- No Wrangler configuration or Cloudflare binding is required for these two basic Functions. If persistent bot state or scheduled execution is added later, its required Cloudflare resources must be created and configured separately.
