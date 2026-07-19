import { afterEach, describe, expect, it } from "vitest";
import { resolveOverflowPopoverPosition } from "./CalendarCellOverflowPopover.position";

describe("resolveOverflowPopoverPosition", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it("keeps a last-row popover inside the viewport", () => {
    window.innerWidth = 1200;
    window.innerHeight = 360;
    const trigger = document.createElement("button");
    document.body.appendChild(trigger);
    trigger.getBoundingClientRect = () => DOMRect.fromRect({
      x: 960,
      y: 310,
      width: 60,
      height: 30,
    });

    const position = resolveOverflowPopoverPosition(trigger);

    expect(position.top).toBeGreaterThanOrEqual(16);
    expect(position.top + position.maxHeight).toBeLessThanOrEqual(window.innerHeight - 16);
  });
});
