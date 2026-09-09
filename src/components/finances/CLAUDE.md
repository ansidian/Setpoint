# Finances shell workspace

Utilities-first `/finances` surface; `/finance` remains the retained record/review foreground.

- `FinancesWorkspace.tsx` — view composition, refresh and foreground entrances
- `financesNavigation.ts` — discriminated Utilities, schedule and Journal URL targets
- `financeWorkspaceModel.ts` — sparse due-month selection, comparable statement facts and exact Journal topology
- `UtilityDetail.tsx` — selected statement hero, chart and protected source history
- `FinanceJournal.tsx` — month-scoped Actual rows with split/pair expansion and calendar-linked day selection; calendar UI/model live in the calendar area
- `finances.css` — dense desktop/mobile layout and control states

No provider calls or inferred financial joins in render trees. Source email uses the existing protected reader. Reads refresh on financial publication, Actual invalidation, focus and tab restoration. Statement history grows from future financial events; there is no backfill workflow.

- `recurringPaymentModel.ts` — shared exact schedule/provider links
- `RecurringPaymentCard.tsx` — Dashboard recurring-payment glance with recorded semantics
- `RecurringPaymentDetail.tsx` — selected recurring occurrence, schedule facts and Journal access
