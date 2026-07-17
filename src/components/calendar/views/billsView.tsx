import {
  allComplete,
  billMatchesItemId,
  compute,
  getDayState,
  getDefaultSelectedItemId,
  hasOverdue,
} from "./bills/billsModel.ts";
import { renderBillsCellContents } from "./bills/BillsCellContent.tsx";
import { renderBillsDetail, renderBillsFloatingDetail } from "./bills/BillsDetailRail.tsx";
import UtilityStatusButton from "./bills/UtilityStatusButton.tsx";
import type { BillsComputed, BillsViewData, FinanceItem } from "./bills/billsModel";
import type { CalendarViewDefinition } from "./calendarViewTypes";

const billsView = {
  compute,
  getDayState,
  hasOverdue,
  allComplete,
  renderCellContents: renderBillsCellContents,
  renderDetail: renderBillsDetail,
  renderFloatingDetail: renderBillsFloatingDetail,
  HeaderExtras: UtilityStatusButton,
  getDefaultSelectedItemId,
  getItemId: (bill: unknown) => {
    const financeItem = bill as FinanceItem | null | undefined;
    return financeItem?.scheduleId || financeItem?.id;
  },
  matchesItemId: billMatchesItemId,
  label: "Bills",
  // Bills' compute keys itemsByDate by full date across the entire fetched
  // range, not by day-of-month within the active month (the way events are
  // windowed). So the infinite-scroll grid can hand that one map to every
  // mounted month instead of withholding it from non-active months — which is
  // what made chips (including paid ones) vanish once scrolled past the
  // active + cached pair.
  monthAgnosticItemsByDate: true,
} satisfies CalendarViewDefinition<BillsViewData, FinanceItem, BillsComputed>;

export default billsView;
