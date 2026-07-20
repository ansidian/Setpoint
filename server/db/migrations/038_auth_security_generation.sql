ALTER TABLE ea_owner
  ADD COLUMN security_generation INTEGER NOT NULL DEFAULT 1
  CHECK (security_generation > 0);

ALTER TABLE ea_sessions
  ADD COLUMN security_generation INTEGER NOT NULL DEFAULT 0;

ALTER TABLE ea_sessions
  ADD COLUMN auth_method TEXT NOT NULL DEFAULT 'legacy'
  CHECK (auth_method IN ('legacy', 'password', 'passkey', 'password_plus_passkey', 'recovery'));

ALTER TABLE ea_sessions
  ADD COLUMN password_authenticated_at INTEGER NOT NULL DEFAULT 0;

ALTER TABLE ea_sessions
  ADD COLUMN step_up_failure_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE ea_sessions
  ADD COLUMN step_up_blocked_until INTEGER NOT NULL DEFAULT 0;

ALTER TABLE ea_pending_auth
  ADD COLUMN security_generation INTEGER NOT NULL DEFAULT 0;

ALTER TABLE ea_pending_auth
  ADD COLUMN password_authenticated_at INTEGER NOT NULL DEFAULT 0;

ALTER TABLE ea_webauthn_challenges
  ADD COLUMN security_generation INTEGER NOT NULL DEFAULT 0;

-- Existing browser sessions remain valid for ordinary application access, but
-- deliberately receive no password-authentication provenance. Their next
-- security mutation therefore requires an explicit password step-up.
UPDATE ea_sessions
   SET security_generation = COALESCE(
     (SELECT security_generation FROM ea_owner WHERE singleton_id = 1),
     0
   );

-- Pre-migration ceremonies have no trustworthy generation or factor
-- provenance. They are short-lived and safe to restart.
DELETE FROM ea_webauthn_challenges;
DELETE FROM ea_pending_auth;
