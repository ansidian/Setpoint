-- Per-schedule bill-pay website URLs, surfaced as a "Pay Online" button on the
-- calendar bill detail. Shape: [{ scheduleId, label, url }] keyed on the stable
-- Actual schedule id. Additive, nullable -- existing rows default to no links.
ALTER TABLE ea_settings
  ADD COLUMN utility_pay_links_json TEXT;
