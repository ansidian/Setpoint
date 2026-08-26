import {
  DefaultColorStyle,
  DefaultFontStyle,
  DefaultSizeStyle,
  T,
  createShapePropsMigrationIds,
  createShapePropsMigrationSequence,
  type RecordProps,
  type TLDefaultColorStyle,
  type TLDefaultFontStyle,
  type TLDefaultSizeStyle,
  type TLShape,
} from "tldraw";

export const CHECKLIST_SHAPE_TYPE = "setpoint-checklist" as const;
export const CHECKLIST_MIN_WIDTH = 260;

const CHECKLIST_MIN_WIDTHS: Record<TLDefaultSizeStyle, number> = {
  s: CHECKLIST_MIN_WIDTH,
  m: 300,
  l: 340,
  xl: 400,
};

export interface ChecklistItem {
  id: string;
  text: string;
  checked: boolean;
}

export interface ChecklistStyleMetrics {
  fontSize: number;
  lineHeight: number;
  padding: number;
  titleRowHeight: number;
  rowHeight: number;
  rowGap: number;
  sectionGap: number;
  checkboxSize: number;
  controlSize: number;
  countFontSize: number;
  addFontSize: number;
}

const CHECKLIST_STYLE_METRICS: Record<TLDefaultSizeStyle, ChecklistStyleMetrics> = {
  s: {
    fontSize: 18,
    lineHeight: 24,
    padding: 12,
    titleRowHeight: 32,
    rowHeight: 36,
    rowGap: 4,
    sectionGap: 8,
    checkboxSize: 18,
    controlSize: 26,
    countFontSize: 11,
    addFontSize: 13,
  },
  m: {
    fontSize: 22,
    lineHeight: 30,
    padding: 16,
    titleRowHeight: 38,
    rowHeight: 42,
    rowGap: 6,
    sectionGap: 10,
    checkboxSize: 20,
    controlSize: 30,
    countFontSize: 12,
    addFontSize: 15,
  },
  l: {
    fontSize: 26,
    lineHeight: 35,
    padding: 20,
    titleRowHeight: 43,
    rowHeight: 48,
    rowGap: 8,
    sectionGap: 12,
    checkboxSize: 22,
    controlSize: 34,
    countFontSize: 14,
    addFontSize: 17,
  },
  xl: {
    fontSize: 32,
    lineHeight: 43,
    padding: 24,
    titleRowHeight: 51,
    rowHeight: 58,
    rowGap: 10,
    sectionGap: 14,
    checkboxSize: 26,
    controlSize: 40,
    countFontSize: 16,
    addFontSize: 20,
  },
};

export function getChecklistStyleMetrics(size: TLDefaultSizeStyle): ChecklistStyleMetrics {
  return CHECKLIST_STYLE_METRICS[size];
}

export function getChecklistMinWidth(size: TLDefaultSizeStyle): number {
  return CHECKLIST_MIN_WIDTHS[size];
}

declare module "tldraw" {
  interface TLGlobalShapePropsMap {
    [CHECKLIST_SHAPE_TYPE]: {
      w: number;
      h: number;
      color: TLDefaultColorStyle;
      font: TLDefaultFontStyle;
      size: TLDefaultSizeStyle;
      title: string;
      items: ChecklistItem[];
    };
  }
}

export type ChecklistShape = TLShape<typeof CHECKLIST_SHAPE_TYPE>;

const checklistItemValidator = T.object({
  id: T.string,
  text: T.string,
  checked: T.boolean,
});

export const checklistShapeProps: RecordProps<ChecklistShape> = {
  w: T.number,
  h: T.number,
  color: DefaultColorStyle,
  font: DefaultFontStyle,
  size: DefaultSizeStyle,
  title: T.string,
  items: T.arrayOf(checklistItemValidator),
};

const checklistShapeVersions = createShapePropsMigrationIds(CHECKLIST_SHAPE_TYPE, {
  AddNativeStyles: 1,
});

export const checklistShapeMigrations = createShapePropsMigrationSequence({
  sequence: [
    {
      id: checklistShapeVersions.AddNativeStyles,
      up: (props) => {
        props.color = "black";
        props.font = "draw";
        props.size = "m";
      },
      down: (props) => {
        delete props.color;
        delete props.font;
        delete props.size;
      },
    },
  ],
});

function createChecklistItemId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `checklist-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function createChecklistItem(id = createChecklistItemId()): ChecklistItem {
  return { id, text: "", checked: false };
}

export function getChecklistMinHeight(
  itemCount: number,
  size: TLDefaultSizeStyle = "m",
): number {
  const metrics = getChecklistStyleMetrics(size);
  const count = Math.max(1, itemCount);
  return (
    metrics.padding * 2
    + metrics.titleRowHeight
    + metrics.sectionGap * 2
    + metrics.controlSize
    + count * metrics.rowHeight
    + Math.max(0, count - 1) * metrics.rowGap
  );
}

export function getChecklistItemLineCount(
  text: string,
  width: number,
  size: TLDefaultSizeStyle = "m",
): number {
  const metrics = getChecklistStyleMetrics(size);
  const controlsWidth = metrics.padding * 2 + metrics.checkboxSize + metrics.controlSize * 2 + 24;
  const charactersPerLine = Math.max(
    1,
    Math.floor((width - controlsWidth) / (metrics.fontSize * 0.55)),
  );
  return text.split("\n").reduce(
    (lineCount, line) => lineCount + Math.max(1, Math.ceil(line.length / charactersPerLine)),
    0,
  );
}

export function getChecklistMinHeightForItems(
  items: readonly ChecklistItem[],
  width: number,
  size: TLDefaultSizeStyle = "m",
): number {
  const metrics = getChecklistStyleMetrics(size);
  const rowsHeight = items.reduce((height, item) => (
    height
    + metrics.rowHeight
    + (getChecklistItemLineCount(item.text, width, size) - 1) * metrics.lineHeight
  ), 0);
  return (
    metrics.padding * 2
    + metrics.titleRowHeight
    + metrics.sectionGap * 2
    + metrics.controlSize
    + rowsHeight
    + Math.max(0, items.length - 1) * metrics.rowGap
  );
}

export function addChecklistItem(
  items: readonly ChecklistItem[],
  afterId: string | null,
  item = createChecklistItem(),
): ChecklistItem[] {
  const next = [...items];
  const afterIndex = afterId ? next.findIndex((candidate) => candidate.id === afterId) : next.length - 1;
  next.splice(afterIndex < 0 ? next.length : afterIndex + 1, 0, item);
  return next;
}

export function updateChecklistItem(
  items: readonly ChecklistItem[],
  itemId: string,
  update: Partial<Pick<ChecklistItem, "text" | "checked">>,
): ChecklistItem[] {
  return items.map((item) => item.id === itemId ? { ...item, ...update } : item);
}

export function removeChecklistItem(items: readonly ChecklistItem[], itemId: string): ChecklistItem[] {
  if (items.length <= 1) return [...items];
  return items.filter((item) => item.id !== itemId);
}

export function moveChecklistItem(
  items: readonly ChecklistItem[],
  itemId: string,
  targetId: string,
  edge: "before" | "after",
): ChecklistItem[] {
  if (itemId === targetId) return [...items];
  const item = items.find((candidate) => candidate.id === itemId);
  if (!item || !items.some((candidate) => candidate.id === targetId)) return [...items];

  const next = items.filter((candidate) => candidate.id !== itemId);
  const targetIndex = next.findIndex((candidate) => candidate.id === targetId);
  next.splice(targetIndex + (edge === "after" ? 1 : 0), 0, item);
  return next;
}
