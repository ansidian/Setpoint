# Finances shell workspace

Utilities-first `/finances` surface; `/finance` remains the retained record/review foreground.

- `FinancesWorkspace.tsx` — view composition, refresh and foreground entrances
- `src/components/shared/WorkspaceLoading.tsx` — app-level loading owner; Finances registers its wallet hero through startup, lazy code and initial Utilities/Journal reads without remounting the animation
- `financesNavigation.ts` — discriminated Utilities, schedule and Journal URL targets
- `financeWorkspaceModel.ts` — date/currency presentation and exact Journal topology
- `FinanceDetailDrawer.tsx` — desktop calendar-replacement panel and full-height mobile sheet with focus restoration and Escape dismissal
- `PaymentDetail.tsx` — unified payment facts and monthly payment history composition
- `PaymentStatusList.tsx` — aligned status, due/payment dates and amounts for utilities and other recurring payments
- `paymentLedgerSort.ts` — recurring ledger ordering with unknown values last
- `MonthlyPaymentChart.tsx` — twelve-month Actual payment history and original-bill markers, with month selection and Journal actions
- `CalendarPaymentPreview.tsx` — calendar-origin quick facts and actions, anchored on desktop and a sheet on mobile, preserving day context
- `PaymentMonthDetails.tsx` — bounded floating desktop and inline mobile month activity, with direct original-email modal actions
- `monthlyPaymentModel.ts` — monthly recorded totals, deduplicated transactions, and original sources associated by exact payment IDs or bill date within the same twelve months
- `paymentPresentationModel.ts` — exact occurrence settlement, independent recorded history and shared row/calendar projection
- `UtilityDetail.tsx` — direct original-email preview and saved-record actions for a month’s bill
- `FinanceJournal.tsx` — month-scoped Actual rows with split/pair expansion and calendar-linked day selection; calendar UI/model live in the calendar area
- `finances.css` — dense desktop/mobile layout and control states

No provider calls or inferred financial joins in render trees. Source email uses the existing protected reader. Reads refresh on financial publication, Actual invalidation, focus and tab restoration. Statement history grows from future financial events; there is no backfill workflow.

Statements retain one original source per managed bill record and preserve prior cycles. Settled facts come from the original receipt; later related emails remain in saved-record history. Payment activity comes from exact Actual evidence, never follow-up email notices. Original sources live in the chart’s existing twelve months, attached to exact recorded payments when available; source-only months never imply a payment amount. The compact month preview scrolls within a bounded region, and Original email opens the shared preview modal above it while preserving selection and focus. There is no separate source-history accordion or chart legend; older records remain available in Activity.

- `recurringPaymentModel.ts` — shared exact schedule/provider links
- `RecurringPaymentCard.tsx` — Dashboard recurring-payment glance with recorded semantics
