# Inbox Reader Map

The desktop and mobile email detail pane: body loading/rendering, triage context, actions, bill-pay resolution, transaction-import status, and reader-specific controls. `Reader.tsx` is the entry point and routes to the desktop or mobile presentation.

## Files

### Entry + surfaces
- `Reader.tsx` — detail-pane router (desktop/mobile), body loading, snooze/bill state
- `DesktopReader.tsx` — shared header and utility actions, original-first reading with a responsive supporting AI column, and bounded bill/task workspaces
- `DesktopReader.css` — reader measure, container-responsive source/context columns and large-display reading scale, scrolling and narrow workspace overlay composition
- `MobileReader.tsx` — focused mobile reading screen with one top bar and actions sheet
- `ReaderShared.tsx` — reader empty state using the shared Inbox presentation
- `readerTypes.ts` — shared reader body, bill-resolution, and surface contracts

### Desktop
- `DesktopReaderActionBar.tsx` — desktop lifecycle actions, consolidated More menu, snooze, and adjacent-email navigation
- `DesktopReaderActionBar.css` — container-responsive action-bar states, cluster separation, and reduced motion

### Mobile
- `MobileBillDrawer.tsx` — mobile slide-up bill-pay sheet with expand/collapse affordance
- `MobileReaderHeader.tsx` — scrolling subject/sender with expandable details and AI summary
- `MobileActionRow.tsx` — single-row mobile action buttons
- `MobileReader.css` — mobile reading layout, safe areas, and disclosure/control states
- `MobileReaderControls.tsx` — mobile status badges

### Body + triage
- `OriginalEmailSection.tsx` / `OriginalEmailSection.css` — full-source reading/original formatting control and message attachments/body
- `EmailBodyPane.tsx` — iframe HTML/plain-text body renderer
- `EmailAttachmentShelf.tsx` / `EmailAttachmentPreview.tsx` — compact file shelf plus safe PDF/raster preview overlay
- `EmailCsvPreview.tsx` — bounded read-only CSV table preview with sticky headers and truncation limits
- `EmailImagePreview.tsx` — raster-image preview viewport with zoom out, zoom in, and fit controls
- `EmailPdfPreview.tsx` — lazy PDF.js canvas renderer with continuous inline page scrolling
- `emailAttachmentDownload.ts` — checked browser object-URL download handoff with delayed byte cleanup
- `emailAttachmentModel.ts` — attachment filtering, naming, size, and preview policy
- `TriagePanel.tsx` / `TriagePanel.css` — What needs you / At a glance summary, desktop suggested-action lead, contextual actions, and disclosed classification details
- `DraftReply.tsx` — AI-drafted reply with send/discard
- `VerificationCodeCallout.tsx` — shared desktop/mobile fresh-code display and copy-before-trash action
- `verificationCodeModel.ts` — pure freshness, expiry, and trash-eligibility projection for verification codes
- `useEmailBody.ts` — fetches and caches body HTML with preview fallback

### Actual, bills, and transaction imports
- `useBillPayResolver.ts` — resolves or reuses the persisted zero-configuration financial plan for the open email
- `ActualActionStatus.tsx` — shared desktop/mobile status strip for canonical Actual reconciliation results
- `actualActionStatusModel.ts` — pure copy/tone/actioned-state projection for Actual reconciliation status
- `EmailActualStatus.tsx` — shared desktop/mobile owner that renders one import-or-reconciliation status
- `emailActualStatusModel.ts` — pure precedence policy across transaction-import and statement reconciliation evidence
- `TransactionImportStatus.tsx` — shared Amazon/PayPal import status with focused Finance review routing
- `transactionImportStatusModel.ts` — pure durable item-to-reader status projection
- `useTransactionImportStatus.ts` — owner-scoped status fetch with stale guards and active-only polling
- `billExtractionBody.ts` — body state for the bill-pay workflow
- `billSeedModel.ts` — pure bill-pay seed derivation plus USD amount formatting
- `remindMeTaskSeedModel.ts` — pure email-to-Todoist seed derivation with Pacific due-date handling and bounded provenance

### Action policy
- `readerActionsModel.ts` — shared action visibility for both panes; delegates snapshot lifecycle gating to the parent inbox workflow model

(Tests are not listed in this map; follow the behavior-ownership policy in `AGENTS.md`.)

## Local patterns

- `Open in Gmail` is desktop-only: mobile omits the web handoff until a reliable iPhone message deep link is verified.
- Body HTML renders inside the existing iframe safety seam; do not render provider HTML directly into the app document.
- Shared action visibility belongs in `readerActionsModel.ts` so desktop, mobile, hotkeys, and dispatch stay aligned.
- `Ask Alfred` is intentionally passed only to the desktop reader and hidden in demo builds; it stages context without sending a prompt or starting a model run.
- Bill and transaction-import status are projections of durable backend state; hooks own fetching and stale-response guards.

## Related

- `../CLAUDE.md` — parent inbox orchestration, list, filters, snooze, undo, and hotkeys
- `src/components/inbox/activeSnapshotWorkflowModel.ts` — snapshot lifecycle rules consumed by reader actions
- `server/routes/briefing/` — email, snapshot, bill, and transaction-import HTTP surfaces
