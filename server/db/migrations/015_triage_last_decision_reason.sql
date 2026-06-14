-- EAD-331 / D-PIPE-3: record why each email landed on its triage decision
-- (preflight rule code, cheap-accept, cheap->strong escalation reason, fallback).
ALTER TABLE ea_email_triage ADD COLUMN last_decision_reason TEXT;
