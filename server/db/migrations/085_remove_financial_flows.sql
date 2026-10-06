-- Setpoint no longer extracts, records, corrects or imports financial activity.
-- Finances is a read-only view of Actual: keep only the Actual connection
-- settings, the Actual metadata and schedule mirrors, and payment display groups.
-- Never re-create any name dropped here; CREATE TABLE IF NOT EXISTS would
-- silently accept a stale shape.

-- Email indexing must stop queuing financial documents before their tables go.
DROP TRIGGER IF EXISTS financial_document_arrival;
DROP TRIGGER IF EXISTS financial_document_evidence_changed;

DROP VIEW IF EXISTS ea_financial_effective_corrections;
DROP VIEW IF EXISTS ea_financial_corrected_sources;

-- Children before parents so the implicit DELETE of DROP TABLE never violates
-- a foreign key. Dropping a table also drops its own indexes and triggers.
DROP TABLE IF EXISTS ea_financial_correction_keep_previews;
DROP TABLE IF EXISTS ea_financial_correction_steps;
DROP TABLE IF EXISTS ea_financial_correction_observations;
DROP TABLE IF EXISTS ea_financial_correction_guards;
DROP TABLE IF EXISTS ea_financial_corrections;
DROP TABLE IF EXISTS ea_financial_correction_previews;
DROP TABLE IF EXISTS ea_financial_document_ai_attempts;
DROP TABLE IF EXISTS ea_financial_event_ai_requests;
DROP TABLE IF EXISTS ea_financial_event_references;
DROP TABLE IF EXISTS ea_financial_documents;
DROP TABLE IF EXISTS ea_financial_events;
DROP TABLE IF EXISTS ea_financial_original_receipts;
DROP TABLE IF EXISTS ea_financial_actual_bindings;
DROP TABLE IF EXISTS ea_financial_activity_aliases;
DROP TABLE IF EXISTS ea_financial_activity_occurrences;
DROP TABLE IF EXISTS ea_financial_identity_conflicts;
DROP TABLE IF EXISTS ea_financial_intake_state;
DROP TABLE IF EXISTS ea_financial_workflow_state;
DROP TABLE IF EXISTS ea_financial_connections;
DROP TABLE IF EXISTS ea_financial_connection_state;
DROP TABLE IF EXISTS ea_finance_utilities;
DROP TABLE IF EXISTS ea_transaction_import_items;
DROP TABLE IF EXISTS ea_transaction_import_runs;
DROP TABLE IF EXISTS ea_transaction_import_mappings;

-- API tokens existed only to authorize the retired Actual quick-transaction write.
DROP TABLE IF EXISTS ea_api_tokens;

ALTER TABLE ea_settings DROP COLUMN bill_pay_mappings_json;
ALTER TABLE ea_settings DROP COLUMN utility_pay_links_json;
ALTER TABLE ea_settings DROP COLUMN financial_profiles_json;
ALTER TABLE ea_settings DROP COLUMN financial_profiles_revision;
ALTER TABLE ea_email_triage DROP COLUMN bill_candidate_json;
ALTER TABLE ea_email_triage DROP COLUMN financial_email_plan_json;

-- The cheap triage tier kept its model choice under the retired bill-extraction
-- names; keep the owner's selection under names that describe its only use.
ALTER TABLE ea_settings RENAME COLUMN bill_extract_provider TO triage_fast_provider;
ALTER TABLE ea_settings RENAME COLUMN bill_extract_model TO triage_fast_model;

-- End-to-end encrypted Actual budgets need their encryption password to sync.
ALTER TABLE ea_settings ADD COLUMN actual_budget_encryption_password_encrypted TEXT;

-- The dashboard no longer has a bills provider.
DELETE FROM ea_current_data_cache WHERE cache_key = 'bills_current';
