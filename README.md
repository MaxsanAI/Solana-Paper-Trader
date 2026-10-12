# Solana Paper Trader

A static Solana market paper-trading simulator. It reads public market data from DexScreener and simulates orders locally in the browser. **It never sends blockchain transactions and never asks for a wallet or private key.**

## Features
- Live Solana pair prices, 24-hour change, liquidity and volume from DexScreener
- Market discovery from DexScreener search, latest token profiles and token boosts
- Browser-based AI scan with manual-only paper-bot approvals: tokens scoring above 50/100 show a TRIGGER BOT button on AI Analysis; scores of 65/100 and above are green. The bot never buys automatically, and manual triggers still pass liquidity, volume, age, momentum, activity, blacklist, cash and position-limit checks.
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
