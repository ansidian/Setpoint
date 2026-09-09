# Finances shell workspace

Utilities-first `/finances` surface; `/finance` remains the retained record/review foreground.

- `FinancesWorkspace.tsx` — view composition, refresh and foreground entrances
- `src/components/shared/WorkspaceLoading.tsx` — app-level loading owner; Finances registers its wallet hero through startup, lazy code and initial Utilities/Journal reads without remounting the animation
- `financesNavigation.ts` — discriminated Utilities, schedule and Journal URL targets
- `financeWorkspaceModel.ts` — sparse due-month selection, comparable statement facts and exact Journal topology
- `FinanceDetailDrawer.tsx` — desktop overlay drawer and padded mobile modal with stable workspace columns, focus restoration and outside/Escape dismissal
- `RecordedPaymentDetail.tsx` — recorded payment facts in Utilities with an explicit Journal action
- `UtilityDetail.tsx` — selected statement hero, chart and protected source history
- `FinanceJournal.tsx` — month-scoped Actual rows with split/pair expansion and calendar-linked day selection; calendar UI/model live in the calendar area
- `RecurringPayments.tsx` — separate Scheduled/Recorded lists for non-utility recurring payments, using the calendar payment projection
- `finances.css` — dense desktop/mobile layout and control states

No provider calls or inferred financial joins in render trees. Source email uses the existing protected reader. Reads refresh on financial publication, Actual invalidation, focus and tab restoration. Statement history grows from future financial events; there is no backfill workflow.

- `recurringPaymentModel.ts` — shared exact schedule/provider links
- `RecurringPaymentCard.tsx` — Dashboard recurring-payment glance with recorded semantics
- `RecurringPaymentDetail.tsx` — selected recurring occurrence, schedule facts and Journal access
