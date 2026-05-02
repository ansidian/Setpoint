import {
  allComplete,
  canNavigateBack,
  compute,
  deadlineMatchesItemId,
  getDayState,
  getDefaultSelectedItemId,
  getDeadlineSelectionId,
  hasOverdue,
} from "./deadlines/deadlinesModel.js";
import { renderDeadlinesCellContents } from "./deadlines/DeadlinesCellContent.jsx";
import { renderDeadlinesDetail, renderDeadlinesFloatingDetail } from "./deadlines/DeadlinesDetailRail.jsx";
import { renderDeadlinesFooter } from "./deadlines/DeadlinesFooter.jsx";
import DeadlinesHeaderExtras from "./deadlines/DeadlinesHeaderExtras.jsx";

const deadlinesView = {
  compute,
  canNavigateBack,
  getDayState,
  hasOverdue,
  allComplete,
  renderCellContents: renderDeadlinesCellContents,
  renderDetail: renderDeadlinesDetail,
  renderFloatingDetail: renderDeadlinesFloatingDetail,
  renderFooter: renderDeadlinesFooter,
  HeaderExtras: DeadlinesHeaderExtras,
  getDefaultSelectedItemId,
  getItemId: getDeadlineSelectionId,
  matchesItemId: deadlineMatchesItemId,
  label: "Deadlines",
};

export default deadlinesView;
