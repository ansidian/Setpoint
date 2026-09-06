import { describe, expect, it } from "vitest";
import {
  floatingDetailOwnsGridSelection, isGridOriginFloatingDetail,
  preservedReanchorSide
} from "./calendarFloatingDetailModel";

describe("calendarFloatingDetailModel", () => {
  it("detects grid-origin detail panels that can be side-flipped", () => {
    expect(isGridOriginFloatingDetail({
      open: true,
      mode: "detail",
      anchorKind: "chip",
      userDragged: false,
    })).toBe(true);

    expect(isGridOriginFloatingDetail({
      open: true,
      mode: "detail",
      anchorKind: "chip",
      userDragged: true,
    })).toBe(false);
  });

  it("lets grid-origin details own passive grid selection while open", () => {
    expect(floatingDetailOwnsGridSelection({
      open: true,
      mode: "detail",
      anchorKind: "span",
      itemId: "birthday-1",
      dateKey: "2026-05-10",
      userDragged: false,
    })).toBe(true);

    expect(floatingDetailOwnsGridSelection({
      open: true,
      mode: "detail",
      anchorKind: "agenda-row",
      itemId: "event-1",
      dateKey: "2026-05-10",
      userDragged: false,
    })).toBe(false);
  });

  it("preserves a reanchored grid side only for the same clean detail session", () => {
    const current = {
      open: true,
      mode: "detail",
      view: "events",
      dateKey: "2026-05-02",
      anchorKind: "chip",
      forcedSide: null,
      preferredSide: null,
      initialPlacement: { caretSide: "left" },
      userDragged: false,
      dirty: false,
    };
    const nextDetail = { anchorKind: "span" };

    expect(preservedReanchorSide(current, nextDetail, "events", "2026-05-02")).toBe("right");
    expect(preservedReanchorSide({ ...current, sideIntent: "user-flip", forcedSide: "left" }, nextDetail, "events", "2026-05-02")).toBeNull();
    expect(preservedReanchorSide({ ...current, dirty: true }, nextDetail, "events", "2026-05-02")).toBeNull();
    expect(preservedReanchorSide(current, nextDetail, "bills", "2026-05-02")).toBeNull();
  });
});
