import {
  allComplete,
  compute,
  getDayState,
  getDefaultSelectedItemId,
  hasOverdue,
} from "./bills/billsModel.js";
import { renderBillsCellContents } from "./bills/BillsCellContent.jsx";
import { renderBillsDetail } from "./bills/BillsDetailRail.jsx";
import { renderBillsFooter } from "./bills/BillsFooter.jsx";
import { renderBillsWorkspaceSupport } from "./bills/BillsWorkspaceSupport.jsx";
import UtilityStatusButton from "./bills/UtilityStatusButton.jsx";

const billsView = {
  compute,
  getDayState,
  hasOverdue,
  allComplete,
  renderCellContents: renderBillsCellContents,
  renderDetail: renderBillsDetail,
  renderFooter: renderBillsFooter,
  renderWorkspaceSupport: renderBillsWorkspaceSupport,
  HeaderExtras: UtilityStatusButton,
  getDefaultSelectedItemId,
  getItemId: (bill) => bill?.id,
  label: "Bills",
};

export default billsView;
