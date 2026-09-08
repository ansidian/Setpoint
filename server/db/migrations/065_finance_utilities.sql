-- Budget-bound utility membership for the financial-event read projection.
CREATE TABLE ea_finance_utilities (
  user_id TEXT NOT NULL, budget_id TEXT NOT NULL, id TEXT NOT NULL,
  label TEXT NOT NULL, provider TEXT NOT NULL, payee_id TEXT NOT NULL,
  schedule_ids_json TEXT NOT NULL CHECK(json_valid(schedule_ids_json)),
  source_senders_json TEXT NOT NULL CHECK(json_valid(source_senders_json)),
  PRIMARY KEY(user_id, budget_id, id)
);
-- Owner-approved membership from the September 2026 identity audit. This seeds
-- persisted configuration only for the verified budget; replacement budgets do
-- not inherit these IDs. Read projections also revalidate payees in that budget.
INSERT INTO ea_finance_utilities
(user_id,budget_id,id,label,provider,payee_id,schedule_ids_json,source_senders_json)
SELECT user_id,actual_budget_sync_id,'electricity','Electricity','Southern California Edison',
'7eb2dbd3-54b3-476e-877e-6988dbd75b18','["7080eaa1-61e7-41ce-a093-9d55566cd26a"]','["sce@message.sce.com","donotreply@email.sce.com"]'
FROM ea_settings WHERE actual_budget_sync_id='24647c47-2aca-45d0-a483-c5d28cc86699';
INSERT INTO ea_finance_utilities
SELECT user_id,actual_budget_sync_id,'water','Water','SGV Water',
'19e7078f-b052-4150-963b-0e16839c98dc','["a8825d2a-e405-4d90-b1a9-77760868dd11"]','["no-reply@invoicecloud.net"]'
FROM ea_settings WHERE actual_budget_sync_id='24647c47-2aca-45d0-a483-c5d28cc86699';
INSERT INTO ea_finance_utilities
SELECT user_id,actual_budget_sync_id,'internet','Internet','Spectrum',
'fdcccbcd-9759-4903-beff-4ea6dfd50297','["1f37e4b0-b06a-47dc-a3c0-c063dedc1d4b"]','["myaccount@spectrumemails.com"]'
FROM ea_settings WHERE actual_budget_sync_id='24647c47-2aca-45d0-a483-c5d28cc86699';
INSERT INTO ea_finance_utilities
SELECT user_id,actual_budget_sync_id,'gas','Gas','SoCalGas',
'9f911d7f-2da9-4ebb-a672-c78daeb956c7','["ddb67ce2-7fcf-4d7e-8a40-c8dd56391123"]','["customerservice@socalgas.com"]'
FROM ea_settings WHERE actual_budget_sync_id='24647c47-2aca-45d0-a483-c5d28cc86699';
INSERT INTO ea_finance_utilities
SELECT user_id,actual_budget_sync_id,'trash','Trash','Valley Vista Services',
'67cf2d85-28d7-41b5-b9c3-875a47b6a283','["532d05ce-b669-4f78-9d5d-45bb37d94715"]','["donotreply@valleyvistaservices.com"]'
FROM ea_settings WHERE actual_budget_sync_id='24647c47-2aca-45d0-a483-c5d28cc86699';

ALTER TABLE ea_finance_utilities ADD COLUMN source_identity_text TEXT NOT NULL DEFAULT '';
UPDATE ea_finance_utilities SET source_identity_text='san gabriel valley water' WHERE id='water' AND budget_id='24647c47-2aca-45d0-a483-c5d28cc86699';
