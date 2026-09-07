# Shared financial foreground

Financial activity, records, and manual backfill live at `/finance` inside WorkspaceRoute's retained foreground. Dashboard, Inbox, and notifications link here directly; legacy Settings workflow URLs redirect here. Settings retains connection repair and finance preferences. Saved history never implies a live Actual read. Pending completion stays with its existing managed/import owner; corrections use only the correction facade.

- `financialNavigation.ts` — exact URL-compatible list/source/run/record targets.
- `financial.css` — adaptive list/detail and record surface; centered viewport-responsive dialogs with bounded content measures; Settings up to 1920px, activity up to 1680px, records up to 1000px, backfill up to 1160px, and a 960px split-list threshold.

- `PendingFinancialRecord.tsx` — shared managed and historical pending completion through their existing owner facades; drafts and inline confirmation.
- Short option lists use `src/components/shared/Dropdown.tsx`; long/creatable lists use `src/components/shared/SearchableDropdown.tsx`. Date fields use `src/components/shared/pickers/DateField.tsx`.

- `CorrectionFields.tsx` — type-aware controlled correction fields, explicit schedule treatment and transfer survivor choice.
- `CorrectionPreview.tsx` — frozen before/after effects and current snapshot presentation.
- `FinancialCorrectionEditor.tsx` — inspect/draft/preview/confirm/status lifecycle, preserving drafts on failures.
- `FinancialRecord.tsx` — shared saved inspection and latest correction status.
- `FinancialRecordHistory.tsx` — chronological related emails, original receipts, and all admitted corrections; protected inline disclosures and explicitly unknown dates.
- `FinancialWorkspace.tsx` — retained list filters, pagination, selection, list scroll and financial-publication/focus refresh without a separate polling loop.
- `correctionPresentation.ts` — raw evidence interpretation and applicable draft fields.
- `useFinancialNavigationGuard.ts` — inline draft discard guard for foreground and browser navigation.

- `FinancialBindingRepair.tsx` — explicit older import binding inspection in the selected budget; no replacement/fuzzy target.

- `transactionImportReviewModel.ts` — existing historical eligibility, signed confirmation projection, and source/run labels shared with backfill.

- `FinancialBackfill.tsx` — bounded Gmail historical scans and saved batch progress; shared activity owns review/results. Loads connection prerequisites only when opened.
- `FinancialEmailRecord.tsx` — compatible email-UID resolution through managed status, with protected source fallback.
