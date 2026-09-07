# Financial Corrections Map

Explicit corrections retain immutable original source receipts. Provider work belongs to the existing Actual singleton.

- `financial-correction-model.ts` — frozen exact ledger and schedule plans and preservation constraints
- `financial-correction-successor.ts` — explicit settled-partial orphan rule retirement
- `financial-correction-result.ts` — latest effective identity and provenance without replacing original receipts
- `financial-correction-store.ts` — preview admission, immutable step journal and source revisions
- `financial-corrections.ts` — authenticated preview, confirmation, status and bounded recovery facade

Attempted steps are observed, never blindly dispatched again. Temporary coordination does not establish permanent ownership of shared schedules or distributed isolation from Actual CRDT clients.
