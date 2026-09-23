# Shared modules

Browser-safe values and contracts shared by server and client. Domain wire contracts are mapped in `types/CLAUDE.md`.

- `financial-connection-projections.ts` — pure canonical provider projections for runtime profiles, utility identities and payment links; shared by production Settings and demo initialization/saves.
- `financial-splits.ts` — exact USD cents and expense split allocation validation shared by review, completion and Actual import.
- `financial-kept-result.ts` — projects an explicitly kept Actual snapshot without inferring intended correction values; retains exact observed evidence and leaves ambiguous results unsummarized.
- `payment-groups.ts` — validates display-only payment organization and reconciles stable items without losing saved assignments when metadata is unavailable.
- `billPaymentAdjustments.ts` — shared bill payment adjustment values.
- `calendar-event-colors.ts`, `deadline-source-colors.ts` — shared event/deadline source colors.
- `calendar-reminder-anchor.ts` — reminder event-start instants, separating Pacific all-day midnight from synthetic layout timestamps.
- `timing.ts` — shared timing constants.
