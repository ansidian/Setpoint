import useAddTaskPanelController from "./add-task-panel/useAddTaskPanelController";
import AddTaskPanelView from "./add-task-panel/AddTaskPanelView";
import type { AddTaskPanelProps } from "./add-task-panel/types";

export default function AddTaskPanel(props: AddTaskPanelProps) {
  const controller = useAddTaskPanelController(props);
  return <AddTaskPanelView controller={controller} host={props.host || "anchored"} />;
}
