-- LIVE TRADER ONLY.
-- Simulator balances, positions, settings, and history must never be written to these tables.

CREATE TABLE IF NOT EXISTS live_positions (
  wallet_address TEXT NOT NULL,
  token_mint TEXT NOT NULL,
  token_symbol TEXT NOT NULL DEFAULT 'TOKEN',
  token_amount_raw TEXT NOT NULL DEFAULT '0',
  entry_price_usd REAL NOT NULL DEFAULT 0,
  last_price_usd REAL,
  take_profit_pct REAL NOT NULL DEFAULT 0,
  stop_loss_pct REAL NOT NULL DEFAULT 0,
  cost_sol REAL NOT NULL DEFAULT 0,
  cost_usd REAL NOT NULL DEFAULT 0,
  entry_sol_usd REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'closing', 'closed', 'error')),
  opened_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  closed_at TEXT,
  PRIMARY KEY (wallet_address, token_mint)
);

CREATE INDEX IF NOT EXISTS idx_live_positions_wallet_status
  ON live_positions(wallet_address, status);

CREATE TABLE IF NOT EXISTS live_trade_events (
  id TEXT PRIMARY KEY,
  wallet_address TEXT NOT NULL,
  token_mint TEXT NOT NULL,
  token_symbol TEXT NOT NULL DEFAULT 'TOKEN',
  side TEXT NOT NULL CHECK (side IN ('BUY', 'SELL')),
  value_usd REAL NOT NULL DEFAULT 0,
  pnl_usd REAL,
  sol_amount REAL,
  price_usd REAL,
  tx_signature TEXT,
  reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_live_trade_events_wallet_created
  ON live_trade_events(wallet_address, created_at DESC);

CREATE TABLE IF NOT EXISTS live_trader_settings (
  wallet_address TEXT PRIMARY KEY,
  take_profit_pct REAL NOT NULL DEFAULT 0,
  stop_loss_pct REAL NOT NULL DEFAULT 0,
  auto_exit_enabled INTEGER NOT NULL DEFAULT 0 CHECK (auto_exit_enabled IN (0, 1)),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
