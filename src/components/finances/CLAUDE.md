# Finances shell workspace

Utilities-first `/finances` surface; `/finance` remains the retained record/review foreground.

- `FinancesWorkspace.tsx` — view composition, refresh and foreground entrances
- `src/components/shared/WorkspaceLoading.tsx` — app-level loading owner; Finances registers its wallet hero through startup, lazy code and initial Utilities/Journal reads without remounting the animation
- `financesNavigation.ts` — discriminated Utilities, schedule and Journal URL targets
- `financeWorkspaceModel.ts` — sparse due-month selection, comparable statement facts and exact Journal topology
- `FinanceDetailDrawer.tsx` — desktop calendar-replacement panel and full-height mobile sheet with focus restoration and Escape dismissal
- `PaymentDetail.tsx` — unified payment facts and monthly payment history composition
- `PaymentStatusList.tsx` — aligned status, due/payment dates and amounts for utilities and other recurring payments
- `paymentLedgerSort.ts` — recurring ledger ordering with unknown values last
- `MonthlyPaymentChart.tsx` — always-visible monthly Actual payment history with transaction selection and Journal actions
- `CalendarPaymentPreview.tsx` — calendar-origin quick facts and actions, anchored on desktop and a sheet on mobile, preserving day context
- `PaymentMonthDetails.tsx` — anchored desktop transaction details and inline mobile history for a selected bar
- `monthlyPaymentModel.ts` — monthly recorded totals and deduplicated transaction groups with exact fee deductions and missing-month gaps
- `paymentPresentationModel.ts` — exact occurrence settlement, independent recorded history and shared row/calendar projection
- `UtilityDetail.tsx` — supporting statements and protected source history
- `FinanceJournal.tsx` — month-scoped Actual rows with split/pair expansion and calendar-linked day selection; calendar UI/model live in the calendar area
- `finances.css` — dense desktop/mobile layout and control states

No provider calls or inferred financial joins in render trees. Source email uses the existing protected reader. Reads refresh on financial publication, Actual invalidation, focus and tab restoration. Statement history grows from future financial events; there is no backfill workflow.

- `recurringPaymentModel.ts` — shared exact schedule/provider links
- `RecurringPaymentCard.tsx` — Dashboard recurring-payment glance with recorded semantics
