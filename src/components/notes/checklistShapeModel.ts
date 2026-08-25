import {
  T,
  createShapePropsMigrationSequence,
  type RecordProps,
  type TLShape,
} from "tldraw";

export const CHECKLIST_SHAPE_TYPE = "setpoint-checklist" as const;
export const CHECKLIST_MIN_WIDTH = 260;

export interface ChecklistItem {
  id: string;
  text: string;
  checked: boolean;
}

declare module "tldraw" {
  interface TLGlobalShapePropsMap {
    [CHECKLIST_SHAPE_TYPE]: {
      w: number;
      h: number;
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
  title: T.string,
  items: T.arrayOf(checklistItemValidator),
};

// The empty sequence establishes the versioned custom-shape migration seam before
// any checklist documents exist. Future prop changes append numbered migrations here.
export const checklistShapeMigrations = createShapePropsMigrationSequence({ sequence: [] });

function createChecklistItemId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `checklist-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function createChecklistItem(id = createChecklistItemId()): ChecklistItem {
  return { id, text: "", checked: false };
}

export function getChecklistMinHeight(itemCount: number): number {
  return 104 + Math.max(1, itemCount) * 36;
}

export function getChecklistItemLineCount(text: string, width: number): number {
  const charactersPerLine = Math.max(1, Math.floor((width - 90) / 7));
  return text.split("\n").reduce(
    (lineCount, line) => lineCount + Math.max(1, Math.ceil(line.length / charactersPerLine)),
    0,
  );
}

export function getChecklistMinHeightForItems(items: readonly ChecklistItem[], width: number): number {
  return 104 + items.reduce(
    (height, item) => height + 36 + (getChecklistItemLineCount(item.text, width) - 1) * 18,
    0,
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
