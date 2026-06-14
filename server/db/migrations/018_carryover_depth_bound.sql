-- Bound carryover so a perpetually-unhandled needs_attention/queued item cannot
-- re-copy into the active snapshot forever (dev pile-up + latent prod issue).
-- Per-item age expiry: each carry bumps carryover_count; copyCarryoverItems stops
-- copying once it reaches CARRYOVER_MAX_DEPTH. Additive, default 0 -- existing rows
-- get up to maxDepth more carries, which is acceptable.
ALTER TABLE ea_briefing_snapshot_items
  ADD COLUMN carryover_count INTEGER NOT NULL DEFAULT 0;
