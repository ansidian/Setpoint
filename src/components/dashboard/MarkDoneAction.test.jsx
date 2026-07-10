import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import MarkDoneAction from "./MarkDoneAction.jsx";

afterEach(cleanup);

describe("MarkDoneAction", () => {
  it("is hidden and untappable at rest (desktop: needs hover/focus reveal)", () => {
    render(<MarkDoneAction onComplete={() => {}} itemTitle="Report" />);
    const btn = screen.getByRole("button", { name: "Mark Report done" });
    expect(btn.style.opacity).toBe("0");
    expect(btn.style.pointerEvents).toBe("none");
  });

  it("is visible and tappable when alwaysVisible (mobile / touch)", () => {
    render(<MarkDoneAction onComplete={() => {}} itemTitle="Report" alwaysVisible />);
    const btn = screen.getByRole("button", { name: "Mark Report done" });
    expect(btn.style.opacity).toBe("1");
    expect(btn.style.pointerEvents).toBe("auto");
  });

  it("carries the shared focus-visible ring class and no inline outline suppression", () => {
    render(<MarkDoneAction onComplete={() => {}} itemTitle="Report" />);
    const btn = screen.getByRole("button", { name: "Mark Report done" });
    expect(btn.className).toContain("sp-focus-ring");
    expect(btn.style.outline).toBe("");
  });

  it("still reveals (opacity 1) on focus even though outline:none was removed", () => {
    render(<MarkDoneAction onComplete={() => {}} itemTitle="Report" />);
    const btn = screen.getByRole("button", { name: "Mark Report done" });
    fireEvent.focus(btn);
    expect(btn.style.opacity).toBe("1");
  });
});
