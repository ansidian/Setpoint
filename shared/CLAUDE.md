# Shared modules

Browser-safe values and contracts shared by server and client. Domain wire contracts are mapped in `types/CLAUDE.md`.

- `payment-groups.ts` — validates display-only payment organization and reconciles stable items without losing saved assignments when metadata is unavailable.
- `calendar-event-colors.ts`, `deadline-source-colors.ts` — shared event/deadline source colors.
- `calendar-reminder-anchor.ts` — reminder event-start instants, separating Pacific all-day midnight from synthetic layout timestamps.
- `timing.ts` — shared timing constants.
