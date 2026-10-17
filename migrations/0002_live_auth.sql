-- Live Trader wallet authentication only. No simulator data is stored here.
CREATE TABLE IF NOT EXISTS live_auth_challenges (
  nonce TEXT PRIMARY KEY,
  wallet_address TEXT NOT NULL,
  message TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_live_auth_challenges_expiry ON live_auth_challenges(expires_at);
CREATE TABLE IF NOT EXISTS live_auth_sessions (
  token_hash TEXT PRIMARY KEY,
  wallet_address TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_live_auth_sessions_wallet ON live_auth_sessions(wallet_address, expires_at);
