# Cloudflare Pages preparation

This repository remains a **paper-trading simulator**. These files prepare a Cloudflare Pages Functions backend; they do not enable real trading and do not deploy anything to Cloudflare by themselves.

## What is included

- `/api/health` — confirms the Functions runtime is responding and explicitly reports live trading as disabled.
- `/api/market?path=...` — same-origin proxy for a small allowlist of DexScreener market-data endpoints.
- Edge response caching with endpoint-specific TTLs, request validation, response-size limits, and an explicit response when DexScreener rate-limits the request.
- The existing GitHub Pages deployment can continue using the public provider directly.

## Before a Cloudflare deployment

1. In Cloudflare Dashboard, open **Workers & Pages** and create or select a Pages project connected to this repository.
2. Ensure the project root is the repository root and the build command is empty for this plain HTML site. The Functions directory must be at the repository root.
3. Do not deploy until the owner is ready. After a deliberate deployment, test `/api/health` and `/api/market?path=%2Flatest%2Fdex%2Fsearch%2F%3Fq%3DSOL`.
4. Check response headers for `x-market-cache: MISS` followed by `HIT` on a repeated request. Cache behavior can vary by edge location.
5. The proxy is not a trading backend. No wallet signing, swaps, private keys, automated server-side trading, persistent bot scheduler, or live order execution is implemented.

## Safety boundaries

- Never put a wallet private key, seed phrase, RPC secret, or trading secret in `index.html`, browser storage, Git, or a public variable.
- The bot in the current app is a browser-based paper bot and runs only while the page is active.
- A genuine autonomous bot would need a separately designed server-side execution service, persistent state, explicit risk limits, secret storage, transaction validation, monitoring, and a separate opt-in before any real funds could be at risk.
- No Wrangler configuration or Cloudflare binding is required for these two basic Functions. If persistent bot state or scheduled execution is added later, its required Cloudflare resources must be created and configured separately.
