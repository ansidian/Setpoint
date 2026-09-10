# Shared financial foreground

Financial activity and records live at `/finance` inside WorkspaceRoute's retained foreground. Dashboard, Inbox, and notifications link here directly; legacy Settings workflow URLs redirect here. Settings retains connection repair and finance preferences. Saved history never implies a live Actual read. Pending completion stays with its existing managed/import owner; corrections use only the correction facade.

- `financialNavigation.ts` — exact URL-compatible list/source/run/record targets.
- `financial.css` — adaptive list/detail and record surface; centered viewport-responsive dialogs with bounded content measures; Settings up to 1920px, activity up to 1680px, records up to 1000px, and a 960px split-list threshold.

- `src/components/bills/financialCompletionDraft.ts` — known-fact prefills and same-revision enrichment for managed completion; untouched fields and clean baselines update together, while owner edits, explicit clears and confirmation drafts remain fixed.
- `PendingFinancialRecord.tsx` — shared managed and arrival-import pending completion through their existing owner facades; drafts and inline confirmation.
- Short option lists use `src/components/shared/Dropdown.tsx`; long/creatable lists use `src/components/shared/SearchableDropdown.tsx`. Date fields use `src/components/shared/pickers/DateField.tsx`.

- `CorrectionFields.tsx` — type-aware controlled correction fields, explicit schedule treatment and transfer survivor choice.
- `CorrectionPreview.tsx` — frozen before/after effects and current snapshot presentation.
- `FinancialCorrectionEditor.tsx` — inspect/draft/preview/confirm/status lifecycle, preserving drafts on failures; stopped corrections support synchronized recheck or explicit kept-result review; exact scheduled transfers remain editable.
- `FinancialRecord.tsx` — shared saved inspection, persistent accepted/processing/confirmed feedback, and latest correction status.
- `FinancialRecordHistory.tsx` — chronological related emails, original receipts, and all admitted corrections; protected inline disclosures and explicitly unknown dates.
- `FinancialAttentionBadge.tsx` — shared positive-only attention count, inline or above the Activity entrance.
- `useFinancialAttentionCount.ts` — attention total for the current source/context/batch scope (otherwise owner-wide), refreshed on visibility, focus and financial changes.
- `FinancialWorkspace.tsx` — retained list filters, pagination, selection, list scroll and financial-publication/focus refresh; a selected processing original has sequential read-only status refresh until settlement, attention, or navigation; source alias promotion preserves the selected form and feedback lifetime.
- `correctionPresentation.ts` — raw evidence interpretation and applicable draft fields.
- `financialActivityPresentation.ts` — currency-aware signed amounts, saved type/date facts, and conservative outcome labels shared by dashboard and activity rows.
- `PaymentConfirmation.tsx` — shared ordinary-payment money-flow review; source owners retain submission and validation.
- `useFinancialNavigationGuard.ts` — inline draft discard guard for foreground and browser navigation.

- `FinancialBindingRepair.tsx` — explicit older import binding inspection in the selected budget; no replacement/fuzzy target.

- `transactionImportReviewModel.ts` — saved-item eligibility, signed confirmation projection, and source labels.

- `FinancialEmailRecord.tsx` — compatible email-UID resolution through managed status, with protected source fallback.

- `KeepActualResult.tsx` — frozen current-result review and explicit keep confirmation; shared snapshot display for accepted results.

The Needs attention list groups processing records under Pending and keeps the badge actionable-only. Managed completion places Dismiss candidate opposite submit, with Confirm dismissal replacing the same button and Keep candidate restoring the draft. Revision-checked dismissal never sends to Actual; its source owner enforces admission protection.

- `useActualRecordingSound.ts` — one fresh confirmed recording cue after explicit submission, with no confirmation deadline while the requested record remains visible; navigation, hidden tabs, rejection, attention, corrections and historical results stay quiet. Audio startup retains its short expiry.
