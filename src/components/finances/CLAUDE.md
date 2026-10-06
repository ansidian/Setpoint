# Finances shell workspace

Read-only `/finances` view of Actual Budget: Payments (schedules and their recorded transactions) and Journal (recorded transactions). Setpoint never writes financial data; the only persisted edit is the Payments display layout (Organize), which never changes Actual.

- `FinancesWorkspace.tsx` — view composition, refresh and row/detail routing; calendar day entries open the same row details as the ledger; mobile uses one compact title header with shared app actions
- `src/components/shared/WorkspaceLoading.tsx` — app-level loading owner; Finances registers its wallet hero through startup, lazy code and initial Payments/Journal reads without remounting the animation
- `financesNavigation.ts` — discriminated Payments, schedule and Journal URL targets
- `financeWorkspaceModel.ts` — date/currency presentation and exact Journal topology
- `FinanceDetailDrawer.tsx` — desktop calendar-replacement panel and full-height mobile sheet with focus restoration and Escape dismissal
- `PaymentDetail.tsx` — payment facts, unconfirmed schedule claims, monthly payment history and an Open in Actual link when the budget URL is configured
- `PaymentStatusList.tsx` — aligned status, due/payment dates and amounts within saved user-defined groups
- `paymentLedgerSort.ts` — recurring ledger ordering with unknown values last
- `MonthlyPaymentChart.tsx` — twelve-month Actual payment history with month selection
- `PaymentMonthDetails.tsx` — bounded floating desktop and inline mobile month records with View in Journal actions
- `monthlyPaymentModel.ts` — per-month totals of unique recorded payments (reciprocal transfer pairs count once)
- `paymentPresentationModel.ts` — exact occurrence settlement from Actual schedules and recorded history, plus the shared row/calendar projection
- `recurringPaymentModel.ts` — exact Actual schedule links
- `FinanceJournal.tsx` — month-scoped Actual rows with split/pair expansion and calendar-linked day selection; mobile selection filters to that day until Show all days or a month change, desktop selection scrolls the full ledger; calendar UI/model live in the calendar area
- `PaymentGroupEditor.tsx` and `payment-groups.css` — staged inline organization, direct row/group dragging, keyboard moves, rename validation and Save/Cancel; persistence is budget-bound display layout keyed by `schedule:<id>` and independent from Actual categories
- `PaymentRowContent.tsx` — shared ledger, editor and drag-preview payment facts
- `finances.css` — dense desktop/mobile layout and control states

No provider calls or inferred financial joins in render trees. Only explicit transaction links settle an occurrence; schedule membership supplies history, and a paid schedule claim without a matching recorded transaction stays unconfirmed. Reads refresh on focus and tab restoration.
