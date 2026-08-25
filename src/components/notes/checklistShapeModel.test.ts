import { describe, expect, it } from "vitest";
import {
  addChecklistItem,
  createChecklistItem,
  getChecklistItemLineCount,
  getChecklistMinHeightForItems,
  moveChecklistItem,
  removeChecklistItem,
} from "./checklistShapeModel";

describe("checklistShapeModel", () => {
  it("adds a flat row after the active item", () => {
    const first = createChecklistItem("first");
    const third = createChecklistItem("third");
    const second = createChecklistItem("second");

    expect(addChecklistItem([first, third], first.id, second).map((item) => item.id))
      .toEqual(["first", "second", "third"]);
  });

  it("keeps one editable row when removing items", () => {
    const first = createChecklistItem("first");
    const second = createChecklistItem("second");

    expect(removeChecklistItem([first], first.id)).toEqual([first]);
    expect(removeChecklistItem([first, second], second.id)).toEqual([first]);
  });

  it("accounts for wrapped and explicit item lines when sizing the card", () => {
    const item = { ...createChecklistItem("long"), text: "A deliberately long checklist item that wraps\nplus another line" };
    const singleLineItem = { ...item, text: "Short item" };

    expect(getChecklistItemLineCount(item.text, 260)).toBeGreaterThan(2);
    expect(getChecklistMinHeightForItems([item], 260))
      .toBeGreaterThan(getChecklistMinHeightForItems([singleLineItem], 260));
  });

  it("moves a row before or after another row without mutating the source order", () => {
    const first = createChecklistItem("first");
    const second = createChecklistItem("second");
    const third = createChecklistItem("third");
    const items = [first, second, third];

    expect(moveChecklistItem(items, third.id, first.id, "before").map((item) => item.id))
      .toEqual(["third", "first", "second"]);
    expect(moveChecklistItem(items, first.id, second.id, "after").map((item) => item.id))
      .toEqual(["second", "first", "third"]);
    expect(items.map((item) => item.id)).toEqual(["first", "second", "third"]);
  });
});
