import { describe, expect, it } from "vitest";
import {
  formatFloatingDetailLabel,
  formatFloatingEditorLabel,
  isGridOriginFloatingDetail,
  preservedReanchorSide,
} from "./calendarFloatingDetailModel";

describe("calendarFloatingDetailModel", () => {
  it("detects grid-origin detail panels that can be side-flipped", () => {
    expect(isGridOriginFloatingDetail({
      open: true,
      mode: "detail",
      anchorKind: "chip",
      parked: false,
      userDragged: false,
    })).toBe(true);

    expect(isGridOriginFloatingDetail({
      open: true,
      mode: "detail",
      anchorKind: "chip",
      parked: true,
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
      parked: false,
      userDragged: false,
      dirty: false,
    };
    const nextDetail = { anchorKind: "span" };

    expect(preservedReanchorSide(current, nextDetail, "events", "2026-05-02")).toBe("right");
    expect(preservedReanchorSide({ ...current, dirty: true }, nextDetail, "events", "2026-05-02")).toBeNull();
    expect(preservedReanchorSide(current, nextDetail, "deadlines", "2026-05-02")).toBeNull();
  });

  it("formats floating detail and editor labels from selected dates", () => {
    expect(formatFloatingDetailLabel("events", "2026-05-02", 2026, 4, null)).toBe("Event · Sat, May 2");
    expect(formatFloatingEditorLabel("create", "deadlines", null, 2026, 4, 3)).toBe("New deadline · Sun, May 3");
    expect(formatFloatingEditorLabel("edit", "bills", null, 2026, 4, null)).toBe("Edit bill · Selected");
  });
});
