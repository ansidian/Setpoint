import {
  BaseBoxShapeTool,
  DefaultToolbar,
  DefaultToolbarContent,
  ToolbarItem,
  type TLComponents,
  type TLUiOverrides,
} from "tldraw";
import { CHECKLIST_SHAPE_TYPE } from "./checklistShapeModel";

export class ChecklistShapeTool extends BaseBoxShapeTool {
  static override id = CHECKLIST_SHAPE_TYPE;
  static override initial = "idle";
  override shapeType = CHECKLIST_SHAPE_TYPE;
}

export const checklistUiOverrides: TLUiOverrides = {
  tools(editor, tools) {
    tools[CHECKLIST_SHAPE_TYPE] = {
      id: CHECKLIST_SHAPE_TYPE,
      icon: "list",
      label: "Checklist",
      onSelect: () => editor.setCurrentTool(CHECKLIST_SHAPE_TYPE),
    };
    return tools;
  },
};

export const checklistUiComponents: TLComponents = {
  Toolbar: (props) => (
    <DefaultToolbar {...props}>
      <ToolbarItem tool={CHECKLIST_SHAPE_TYPE} />
      <DefaultToolbarContent />
    </DefaultToolbar>
  ),
};
