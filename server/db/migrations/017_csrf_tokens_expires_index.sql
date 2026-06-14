-- P3-19: index ea_csrf_tokens.expires_at so the opportunistic expired-token
-- sweep on /accounts/gmail/auth (server/routes/accounts.js) uses an index
-- instead of a full table scan as abandoned OAuth flows accumulate.
CREATE INDEX IF NOT EXISTS idx_ea_csrf_tokens_expires
  ON ea_csrf_tokens(expires_at);
