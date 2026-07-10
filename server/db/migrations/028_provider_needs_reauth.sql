-- server/db/migrations/028_provider_needs_reauth.sql
-- OAuth reconnect signaling: flag when a provider's token grants are revoked (invalid_grant).
-- Account-level (Gmail/Calendar share ea_accounts rows): needs_reauth on ea_accounts.
-- Service-level (Todoist uses ea_settings for tokens): todoist_needs_reauth on ea_settings.
ALTER TABLE ea_accounts ADD COLUMN needs_reauth INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ea_settings ADD COLUMN todoist_needs_reauth INTEGER NOT NULL DEFAULT 0;
