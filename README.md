# Solana Paper Trader

A static Solana market paper-trading simulator. It uses public DexScreener market data and simulates buys/sells locally in the browser. **It never sends blockchain transactions and never asks for a wallet or private key.**

## Features
- Real Solana pair prices, 24-hour change, liquidity and volume from DexScreener
- Virtual wallet with configurable starting balance
- Simulated buy and sell orders, position mark-to-market and trade history
- Per-position take-profit and stop-loss targets; auto-close checks while the page is open and receiving price updates
- localStorage persistence and CSV export
- Responsive dark UI, no build step or backend required

## GitHub Pages
This is a plain static site; `index.html` is at repository root. To publish:
1. Open **Settings → Pages**.
2. Under **Build and deployment**, choose **Deploy from a branch**.
3. Select branch **main** and folder **/(root)**, then Save.
4. Wait for the Pages deployment to complete in **Actions**.

The repository currently is private. On GitHub Free, change it to **Public** before enabling Pages; GitHub Pages sites are publicly available. See the [official GitHub Pages guide](https://docs.github.com/en/pages/quickstart).

## Important limitations
- Browser-only app: auto TP/SL runs only while the page is open and the browser is executing JavaScript. It is not a server-side bot and cannot monitor trades when closed.
- Price endpoints can be delayed, rate-limited, or unavailable; the app displays an error when market data cannot be fetched.
- localStorage is device/browser-specific and can be cleared by the user.
- Token listings and price data are not endorsements of token safety. No wallet connection, real orders, or private keys are used.
- Tailwind CSS is loaded from its CDN; an internet connection is required.
