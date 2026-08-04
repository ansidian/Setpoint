# Inbox Reader Map

The desktop and mobile email detail pane: body loading/rendering, triage context, actions, bill-pay resolution, transaction-import status, and reader-specific controls. `Reader.tsx` is the entry point and routes to the desktop or mobile presentation.

## Files

### Entry + surfaces
- `Reader.tsx` — detail-pane router (desktop/mobile), body loading, snooze/bill state
- `DesktopReader.tsx` — desktop detail layout with triage panel
- `MobileReader.tsx` — mobile detail pane with action row
- `ReaderShared.tsx` — section accordion and empty-state primitives
- `readerTypes.ts` — shared reader body, bill-resolution, and surface contracts

### Desktop
- `DesktopReaderActionBar.tsx` — desktop reader action clusters, grouped menus, and adaptive label collapse
- `DesktopReaderActionBar.css` — container-responsive action-bar states, cluster separation, and reduced motion

### Mobile
- `MobileBillDrawer.tsx` — mobile slide-up bill-pay sheet with expand/collapse affordance
- `MobileReaderHeader.tsx` — mobile reader subject/sender/status-pills/briefing-triage header block
- `MobileActionRow.tsx` — single-row mobile action buttons
- `MobileTriageBar.tsx` — always-visible primary one-tap triage verbs
- `MobileReaderControls.tsx` — pill badges and inline mobile controls

### Body + triage
- `EmailBodyPane.tsx` — iframe HTML/plain-text body renderer
- `TriagePanel.tsx` — AI summary, bullets, urgency, and lane tag display
- `DraftReply.tsx` — AI-drafted reply with send/discard
- `useEmailBody.ts` — fetches and caches body HTML with preview fallback

### Actual, bills, and transaction imports
- `useBillPayResolver.ts` — resolves bill extraction for the open email
- `ActualActionStatus.tsx` — shared desktop/mobile status strip for canonical Actual reconciliation results
- `actualActionStatusModel.ts` — pure copy/tone/actioned-state projection for Actual reconciliation status
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

- Body HTML renders inside the existing iframe safety seam; do not render provider HTML directly into the app document.
- Shared action visibility belongs in `readerActionsModel.ts` so desktop, mobile, hotkeys, and dispatch stay aligned.
- Bill and transaction-import status are projections of durable backend state; hooks own fetching and stale-response guards.

## Related

- `../CLAUDE.md` — parent inbox orchestration, list, filters, snooze, undo, and hotkeys
- `src/components/inbox/activeSnapshotWorkflowModel.ts` — snapshot lifecycle rules consumed by reader actions
- `server/routes/briefing/` — email, snapshot, bill, and transaction-import HTTP surfaces
