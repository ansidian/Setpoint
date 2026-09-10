# Inbox Reader Map

The desktop and mobile email detail pane: body loading/rendering, triage context, actions, financial profile creation, saved financial status, and reader-specific controls. `Reader.tsx` is the entry point and routes to the desktop or mobile presentation.

## Files

### Entry + surfaces
- `Reader.tsx` — detail-pane router (desktop/mobile), body loading, in-app discard protection for task/reply edits and selected-email profile navigation
- `DesktopReader.tsx` — shared header and utility actions, original-first reading with a responsive supporting AI column, a compact single-column source view while discussing with Alfred, and a bounded task workspace
- `DesktopReader.css` — reader measure, container-responsive source/context columns and large-display reading width, scrolling and narrow workspace overlay composition
- `MobileReader.tsx` — focused mobile reading screen with one top bar and actions sheet
- `ReaderShared.tsx` — reader empty state using the shared Inbox presentation
- `readerTypes.ts` — shared reader body, bill-resolution, and surface contracts

### Desktop
- `DesktopReaderActionBar.tsx` — desktop lifecycle actions, consolidated More menu, snooze, and adjacent-email navigation
- `DesktopReaderActionBar.css` — container-responsive action-bar states, cluster separation, and reduced motion

### Mobile
- `MobileReaderHeader.tsx` — scrolling subject/sender with expandable details and AI summary
- `MobileActionRow.tsx` — single-row mobile action buttons
- `MobileReader.css` — mobile reading layout, safe areas, and disclosure/control states
- `MobileReaderControls.tsx` — mobile status badges

### Body + triage
- `EmailContentSection.tsx` — message attachments and source body at full content height
- `EmailBodyPane.tsx` — iframe HTML/plain-text body renderer
- `EmailAttachmentShelf.tsx` / `EmailAttachmentPreview.tsx` — compact file shelf plus safe PDF/raster preview overlay
- `EmailCsvPreview.tsx` — bounded read-only CSV table preview with sticky headers and truncation limits
- `EmailImagePreview.tsx` — raster-image preview viewport with zoom out, zoom in, and fit controls
- `EmailPdfPreview.tsx` — lazy PDF.js canvas renderer with continuous inline page scrolling
- `emailAttachmentDownload.ts` — checked browser object-URL download handoff with delayed byte cleanup
- `emailAttachmentModel.ts` — attachment filtering, naming, size, and preview policy
- `TriagePanel.tsx` / `TriagePanel.css` — What needs you / At a glance summary, desktop suggested-action lead, contextual actions, disclosed classification details; summary stays expanded during Alfred discussions
- `DraftReply.tsx` — AI-drafted reply with send/discard
- `VerificationCodeCallout.tsx` — shared desktop/mobile fresh-code display and copy-before-trash action
- `verificationCodeModel.ts` — pure freshness, expiry, and trash-eligibility projection for verification codes
- `useEmailBody.ts` — fetches and caches body HTML with preview fallback

### Actual, bills, and transaction imports
- `useBillPayResolver.ts` — resolves or reuses the financial plan only for an already classified financial email; profile creation never forces extraction
- `ActualActionStatus.tsx` — shared desktop/mobile status strip for canonical Actual reconciliation results
- `actualActionStatusModel.ts` — pure copy/tone/actioned-state projection for Actual reconciliation status
- `EmailActualStatus.tsx` — informational desktop/mobile status; prefers the live managed financial event, otherwise displays retained import/reconciliation status
- `emailActualStatusModel.ts` — pure precedence policy across transaction-import and statement reconciliation evidence
- `TransactionImportStatus.tsx` — shared Amazon/PayPal import status with focused Finance review routing
- `transactionImportStatusModel.ts` — pure durable item/correction-to-reader status projection with exact shared record links
- `useTransactionImportStatus.ts` — owner-scoped financial-event/import status with stale guards, pending polling and slower waiting-state refresh; Finance can opt into all-state polling for late evidence; accepted owner completions refresh status and restart polling
- `billExtractionBody.ts` — source body state for classified financial plan resolution
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
- **Create profile** requires a recognized triage `event_kind` other than `other`, independent of lifecycle visibility. The client-only seed uses that selected email’s exact sender and already available, source-matched financial context; unknown activity or Actual destinations remain unset. Settings opens an enabled, unsaved draft and requires explicit Save. Task/reply edits retain their discard guard. Financial completion and correction stay in Dashboard/Finances; reader status is informational.

## Related

- `../CLAUDE.md` — parent inbox orchestration, list, filters, snooze, undo, and hotkeys
- `src/components/inbox/activeSnapshotWorkflowModel.ts` — snapshot lifecycle rules consumed by reader actions
- `server/routes/briefing/` — email, snapshot, bill, and transaction-import HTTP surfaces
