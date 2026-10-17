# Cloudflare Pages preparation

This repository keeps the paper simulator fully separate from real Live Trading. The simulator's balance, positions, settings, and history remain in browser localStorage. The D1 schema in this repository is exclusively for Live Trader data.

## Included endpoints and resources

- `/api/health` — reports whether Pages Functions, Workers AI, the Jupiter secret, and the live-only D1 binding are configured.
- `/api/market?path=...` — same-origin proxy for a small allowlist of DexScreener market-data endpoints.
- `/api/swap/order` — validated SOL-to-token or token-to-SOL order proxy to Jupiter Swap API V2.
- `/api/swap/execute` — forwards a transaction already signed by the connected wallet to Jupiter for execution.
- `migrations/0001_live_trader.sql` — tables for Live Trader positions, live trade events, and live TP/SL preferences only. It has no simulator tables.

## Configure the Live Trader D1 database

The intended database is:

- **Database name:** `solana-paper-trader-db`
- **Database ID:** `88596e1c-a46c-4fbe-b239-3f78f113b95f`
- **Pages binding name:** `LIVE_DB`

1. In Cloudflare Dashboard, open **Workers & Pages → D1 SQL Database** and select `solana-paper-trader-db`.
2. Open **Console / SQL Console**, paste the complete contents of `migrations/0001_live_trader.sql`, and run it once. The statements use `IF NOT EXISTS`, so rerunning the migration is safe.
3. Open **Workers & Pages → your Pages project → Settings → Bindings** (the section may be called **D1 database bindings**).
4. Add a D1 database binding with variable name **`LIVE_DB`** and select the database with ID `88596e1c-a46c-4fbe-b239-3f78f113b95f`.
5. Save and redeploy the Pages project, then open `/api/health`. Confirm `liveDatabaseConfigured: true` and `checks.liveStorage: "D1-LIVE_DB-configured"`.

**Important:** adding the binding and tables establishes the database only. The UI does not yet persist live positions to D1 until the Live Trader persistence API is implemented and connected. Do not treat localStorage as durable cross-device storage yet.

## Configure live swaps

1. Ensure the Pages project root is the repository root and the build command is empty for this plain HTML site. The Functions directory must be at the repository root.
2. In Pages **Settings → Variables and Secrets**, add `JUPITER_API_KEY` as a secret from the official Jupiter developer portal. Never add this key to GitHub or browser code.
3. After deployment, test `/api/market?path=%2Flatest%2Fdex%2Fsearch%2F%3Fq%3DSOL`. Repeated requests may return `x-market-cache: HIT`; cache behavior can vary by edge location.

## Safety and separation

- Never put a wallet private key, seed phrase, RPC secret, or trading secret in `index.html`, browser storage, Git, or a public variable. `JUPITER_API_KEY` must be a Cloudflare Pages secret.
- D1 tables are named `live_*` and are for real Live Trader tracking only. Do not write simulator balances, paper positions, paper history, or simulator settings into them.
- The current live swap flow requires the user to sign transactions in Phantom or Solflare. A D1 binding stores data; it does not itself monitor prices or execute sales while the site is closed.
- Any API that reads or mutates a wallet's records must authenticate ownership of that wallet, not trust a client-supplied public address alone.
- The existing GitHub Pages simulator stays independent. D1/Pages Functions are available only on the Cloudflare Pages deployment.
