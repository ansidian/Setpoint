import {
  allComplete,
  billMatchesItemId,
  compute,
  getDayState,
  getDefaultSelectedItemId,
  hasOverdue,
} from "./bills/billsModel.js";
import { renderBillsCellContents } from "./bills/BillsCellContent.jsx";
import { renderBillsDetail, renderBillsFloatingDetail } from "./bills/BillsDetailRail.jsx";
import { renderBillsFooter } from "./bills/BillsFooter.jsx";
import UtilityStatusButton from "./bills/UtilityStatusButton.jsx";

const billsView = {
  compute,
  getDayState,
  hasOverdue,
  allComplete,
  renderCellContents: renderBillsCellContents,
  renderDetail: renderBillsDetail,
  renderFloatingDetail: renderBillsFloatingDetail,
  renderFooter: renderBillsFooter,
  HeaderExtras: UtilityStatusButton,
  getDefaultSelectedItemId,
  getItemId: (bill) => bill?.scheduleId || bill?.id,
  matchesItemId: billMatchesItemId,
  label: "Bills",
};

export default billsView;
