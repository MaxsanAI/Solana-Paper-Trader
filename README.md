# Solana Paper Trader

A Solana market terminal with a separate paper-trading simulator and an opt-in, wallet-signed live swap page. Paper trades stay local and simulated. Live swaps are only available on a Cloudflare Pages deployment after the owner configures the Jupiter API secret; the app never asks for or stores a seed phrase/private key.

## Features
- Live Solana pair prices, 24-hour change, liquidity and volume from DexScreener
- Market discovery from DexScreener search, latest token profiles and token boosts
- Browser-based AI scan with manual-only paper-bot approvals: tokens scoring above 50/100 show a TRIGGER BOT button on AI Analysis; scores of 65/100 and above are green. The bot never buys automatically. Manual approval may override AI strategy filters (liquidity, volume, age, momentum and activity), but still checks the Solana token address and live price, stablecoin exclusion, blacklist, duplicate open positions, virtual cash and position limit.
- Basic entry filter: positive 24-hour momentum between 2% and 18%, minimum liquidity/volume, and pair age of at least one hour when the age is provided by the data source
- Virtual wallet with configurable starting balance
- Simulated buy/sell orders, position mark-to-market, trade history and CSV export
- Per-position take-profit and stop-loss checks while the page is open and receiving market updates
- Local browser storage; responsive dark UI; no build step or backend required

## GitHub Pages
The app is a plain static site with index.html at the repository root. The workflow in .github/workflows/static.yml deploys the site from main.

## Important limitations
- The manual paper-bot is **not** a 24/7 hosted service. AI scans and simulated position management run only while the page is open and the browser is executing JavaScript. AI scans do not execute buys; each entry requires a manual TRIGGER BOT approval.
- This is paper trading only. No real tokens are bought or sold, and no wallet is connected.
- Liquidity, volume, age and momentum filters are simple heuristics, not a security audit or a guarantee against scams or losses.
- Market data may be delayed, rate-limited or unavailable. Token prices and local history are not synchronized across devices.
- TP/SL checks run only while the page is open and receiving market updates.
- Tailwind CSS is loaded from its CDN, so an internet connection is required.


## Live Trading (opt-in, Cloudflare Pages only)

- Open **Live Trading** and connect either Phantom or Solflare.
- Select a token in Terminal, then choose a small buy size in SOL (initial cap: 0.25 SOL per buy).
- The wallet must sign each swap. The app never receives private keys and does not auto-buy.
- **Sell tracked balance** sells the token amount recorded from buys made through this browser. Check your wallet before trading; holdings bought elsewhere are not included in this local tracker.
- Live swaps use Jupiter Swap API V2 through Cloudflare Pages Functions. GitHub Pages is static and cannot safely hold the API secret, so live swaps will not work on the GitHub Pages deployment.
- To enable live swaps, deploy this repository to Cloudflare Pages and add a secret named `JUPITER_API_KEY` in the project's **Settings → Variables and Secrets**. Obtain the key from the official Jupiter developer portal. Never put the key in `index.html`, Git, or a public variable.
- Test the functions on the Cloudflare deployment at `/api/swap/order` only through the app. Without the secret, the API returns a clear disabled message.

Live trading is high risk. The 0.25 SOL cap is a basic guardrail, not a guarantee of safety. Verify token mints, slippage/route details shown by your wallet, and transaction results before retrying failed or timed-out requests.
