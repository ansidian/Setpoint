import {
  allComplete,
  canNavigateBack,
  compute,
  getDayState,
  getDefaultSelectedItemId,
  hasOverdue,
} from "./deadlines/deadlinesModel.js";
import { renderDeadlinesCellContents } from "./deadlines/DeadlinesCellContent.jsx";
import { renderDeadlinesDetail } from "./deadlines/DeadlinesDetailRail.jsx";
import { renderDeadlinesFooter } from "./deadlines/DeadlinesFooter.jsx";
import { renderDeadlinesWorkspaceSupport } from "./deadlines/DeadlinesWorkspaceSupport.jsx";
import DeadlinesHeaderExtras from "./deadlines/DeadlinesHeaderExtras.jsx";

const deadlinesView = {
  compute,
  canNavigateBack,
  getDayState,
  hasOverdue,
  allComplete,
  renderCellContents: renderDeadlinesCellContents,
  renderDetail: renderDeadlinesDetail,
  renderFooter: renderDeadlinesFooter,
  renderWorkspaceSupport: renderDeadlinesWorkspaceSupport,
  HeaderExtras: DeadlinesHeaderExtras,
  getDefaultSelectedItemId,
  getItemId: (task) => task?.id,
  label: "Deadlines",
};

export default deadlinesView;
