# Financial Activity Map

Shared history over the existing managed-event and transaction-import owners. Reads never admit work or query Actual. Authentication supplies the owner.

- `financial-activity-display.ts` — captured monetary labels and source snapshots; completed history never uses later source reassessment
- `financial-activity-binding.ts` — explicit exact imported-ID binding with original source/account and budget isolation; never fuzzy matches or creates replacements
- `financial-activity.ts` — one consistent owner snapshot, semantic filtering and pagination, exact occurrence lookup, and immutable receipt and latest correction projection; detail adds source dates and every correction’s saved state/attempt times in the same read snapshot

Migration 063 owns permanent source occurrence aliases and append-only original receipts. An Actual target is evidence for one activity, never ownership of every later activity using the same schedule. The existing source owners retain completion and execution policy.

Needs attention includes processing rows for the Pending section until verified settlement. `attentionTotal` counts actionable rows separately across the current source/context/run scope, before pagination; dashboard and badges use it.
