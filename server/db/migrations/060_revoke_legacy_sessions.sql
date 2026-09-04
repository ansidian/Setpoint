-- Retire every session that could have been replayed through the raw-token
-- compatibility path, including previously rehashed attacker-supplied tokens.
UPDATE ea_owner SET security_generation = security_generation + 1;
DELETE FROM ea_sessions;
DELETE FROM ea_pending_auth;
DELETE FROM ea_webauthn_challenges;
