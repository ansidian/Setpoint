# Shared modules

Browser-safe values and contracts shared by server and client. Domain wire contracts are mapped in `types/CLAUDE.md`.

- `financial-kept-result.ts` — projects an explicitly kept Actual snapshot without inferring intended correction values; retains exact observed evidence and leaves ambiguous results unsummarized.
- `billPaymentAdjustments.ts` — shared bill payment adjustment values.
- `calendar-event-colors.ts`, `deadline-source-colors.ts` — shared event/deadline source colors.
- `timing.ts` — shared timing constants.
