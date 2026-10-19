# Cloudflare Pages preparation

This repository keeps the paper simulator fully separate from real Live Trading. The simulator's balance, positions, settings, and history remain in browser localStorage. The D1 schema in this repository is exclusively for Live Trader data.

## Included endpoints and resources

- `/api/health` — reports Pages Functions, Workers AI, the Raydium swap integration, optional custom Solana RPC, and the live-only D1 binding.
- `/api/market?path=...` — same-origin proxy for a small allowlist of DexScreener market-data endpoints.
- `/api/swap/order` — validates a SOL-to-token or token-to-SOL request, gets a Raydium Trade API quote, and builds unsigned versioned transactions for the connected wallet to review and sign.
- `/api/swap/execute` — sends only transactions already signed by the user's wallet to Solana mainnet RPC and checks their confirmation status. Jupiter is not used for live swap execution.
- `migrations/0001_live_trader.sql` — tables for Live Trader positions, live trade events, and live TP/SL preferences only. It has no simulator tables.
- `migrations/0002_live_auth.sql` — one-time wallet-signature challenges and expiring Live Trader sessions.
- `/api/live/auth/challenge` and `/api/live/auth/verify` — verify wallet ownership with a signed message (no transaction is requested).
- `/api/live/data` — read and write only the authenticated wallet's Live Trader positions and history.

## Configure the Live Trader D1 database

The intended database is:

- **Database name:** `solana-paper-trader-db`
- **Database ID:** `88596e1c-a46c-4fbe-b239-3f78f113b95f`
- **Pages binding name:** `LIVE_DB`

1. In Cloudflare Dashboard, open **Workers & Pages → D1 SQL Database** and select `solana-paper-trader-db`.
2. Open **Console / SQL Console**, paste the complete contents of `migrations/0001_live_trader.sql`, and run it once. The statements use `IF NOT EXISTS`, so rerunning the migration is safe.
3. In the same database console, paste and run the complete contents of `migrations/0002_live_auth.sql`. This second migration adds the wallet-authentication tables required by the new Live Trader API.
4. Open **Workers & Pages → your Pages project → Settings → Bindings** (the section may be called **D1 database bindings**).
5. Add a D1 database binding with variable name **`LIVE_DB`** and select the database with ID `88596e1c-a46c-4fbe-b239-3f78f113b95f`.
6. Save and redeploy the Pages project, then open `/api/health`. Confirm `liveDatabaseConfigured: true` and `checks.liveStorage: "D1-LIVE_DB-configured"`.

**Important:** the Live Trader UI now uses a wallet-signed message to authenticate access, then loads and saves confirmed live position/trade records through `/api/live/data`. A message signature is not a transaction and does not spend funds. The simulator continues to use its own browser `localStorage` and is never written to D1. Run both migrations before testing this flow.

## Configure Raydium live swaps

1. Ensure the Cloudflare Pages project root is the repository root, the build command is empty for this plain HTML site, and the Functions directory is at the repository root.
2. The live swap path uses Raydium's public Trade API and the public Solana mainnet RPC by default. **A `JUPITER_API_KEY` is no longer required for live swaps.** You can remove that secret from Cloudflare Pages after the new deployment is live and verified.
3. Optional but recommended for reliability: in Cloudflare Pages **Settings → Variables and Secrets**, add `SOLANA_RPC_URL` as a server-side secret or variable containing an HTTPS Solana mainnet RPC URL from a provider you trust. Do not put RPC credentials in `index.html` or commit them to GitHub.
4. Deploy the latest `main` branch, then open `/api/health`. It should report `swapProvider: "Raydium Trade API"`, `liveTradingEnabled: true`, and `orderExecution: "raydium-trade-api-and-solana-rpc-wallet-signature-required"`.
5. Test with a small order. The terminal requests a Raydium quote, shows a manual confirmation with the token mint, estimated price impact, slippage, and transaction count, and only then asks the connected wallet to sign. If the quote becomes old, it is rebuilt and confirmation is requested again.


## Safety and separation

- Never put a wallet private key, seed phrase, RPC secret, or trading secret in `index.html`, browser storage, Git, or a public variable. If you configure `SOLANA_RPC_URL` with a provider credential, keep it server-side in Cloudflare Pages.
- D1 tables are named `live_*` and are for real Live Trader tracking only. Do not write simulator balances, paper positions, paper history, or simulator settings into them.
- The current live swap flow requires the user to approve the in-terminal confirmation and sign the prepared transaction(s) with the connected trading wallet (embedded wallet, Phantom, or Solflare when supported). A D1 binding stores data; it does not itself monitor prices or execute sales while the site is closed.
- Any API that reads or mutates a wallet's records must authenticate ownership of that wallet, not trust a client-supplied public address alone. Live Trader sessions expire after 12 hours and are kept in sessionStorage for the current browser tab.
- The existing GitHub Pages simulator stays independent. D1/Pages Functions are available only on the Cloudflare Pages deployment.


## MoonPay SOL card purchases

The built-in wallet includes a card-purchase panel that routes users to MoonPay checkout. Live purchases are **not active until the site owner has a MoonPay partner account and approved production access**.

In the Cloudflare Pages project settings, add these environment variables (use **Secrets** for the secret key):

- `MOONPAY_PUBLIC_KEY` — MoonPay publishable key (`pk_test_...` for sandbox or `pk_live_...` for production).
- `MOONPAY_SECRET_KEY` — MoonPay secret key. Keep this server-side only; never place it in HTML or JavaScript.
- `MOONPAY_ENV` — set to `sandbox` for testing. For approved production keys, use `production` or leave it unset.

Then redeploy the Cloudflare Pages project. The function at `/api/onramp/sign` signs the checkout URL server-side so the user's embedded wallet address can be prefilled securely. The purchase is processed by MoonPay; this app never receives card details. MoonPay decides supported countries, payment methods, fees, limits, and identity verification. Test with sandbox credentials first. GitHub Pages does not run Cloudflare Pages Functions, so this purchase integration requires the Cloudflare Pages deployment.
