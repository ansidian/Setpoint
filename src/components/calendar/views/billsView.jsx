import { allComplete, compute, getDayState, hasOverdue } from "./bills/billsModel.js";
import { renderBillsCellContents } from "./bills/BillsCellContent.jsx";
import { renderBillsDetail } from "./bills/BillsDetailRail.jsx";
import { renderBillsFooter } from "./bills/BillsFooter.jsx";
import UtilityStatusButton from "./bills/UtilityStatusButton.jsx";

const billsView = {
  compute,
  getDayState,
  hasOverdue,
  allComplete,
  renderCellContents: renderBillsCellContents,
  renderDetail: renderBillsDetail,
  renderFooter: renderBillsFooter,
  HeaderExtras: UtilityStatusButton,
};

export default billsView;
