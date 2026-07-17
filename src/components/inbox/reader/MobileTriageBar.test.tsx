// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import MobileTriageBar from "./MobileTriageBar";
import { resolveReaderActions } from "./readerActionsModel";

afterEach(cleanup);

describe("MobileTriageBar", () => {
  it("offers the five primary snapshot verbs as exact one-tap commands", () => {
    const onAction = vi.fn();
    const onSnooze = vi.fn();

    render(
      <MobileTriageBar
        actions={{
          canHandle: true,
          canMoveToFyi: true,
          canMoveToNoise: true,
          showDestructiveActions: true,
        }}
        onAction={onAction}
        onSnooze={onSnooze}
      />,
    );

    expect(screen.getAllByRole("button").map((button) => button.textContent)).toEqual([
      "Handled",
      "FYI",
      "Noise",
      "Snooze",
      "Trash",
    ]);

    fireEvent.click(screen.getByRole("button", { name: "Handled" }));
    fireEvent.click(screen.getByRole("button", { name: "FYI" }));
    fireEvent.click(screen.getByRole("button", { name: "Noise" }));
    fireEvent.click(screen.getByRole("button", { name: "Snooze" }));
    fireEvent.click(screen.getByRole("button", { name: "Trash" }));

    expect(onAction.mock.calls).toEqual([
      ["snapshot-handled"],
      ["snapshot-move-lane", "fyi"],
      ["snapshot-move-lane", "noise"],
      ["trash"],
    ]);
    expect(onSnooze).toHaveBeenCalledTimes(1);
  });

  it("limits live email triage to Snooze and Trash", () => {
    render(
      <MobileTriageBar
        actions={resolveReaderActions({ id: "live-1" })}
        onAction={() => {}}
        onSnooze={() => {}}
      />,
    );

    expect(screen.getAllByRole("button").map((button) => button.textContent)).toEqual([
      "Snooze",
      "Trash",
    ]);
  });

  it("disables snapshot triage verbs while a snapshot mutation is pending", () => {
    render(
      <MobileTriageBar
        actions={{
          canHandle: true,
          canMoveToFyi: true,
          canMoveToNoise: true,
          showDestructiveActions: true,
        }}
        onAction={() => {}}
        onSnooze={() => {}}
        snapshotPending
      />,
    );

    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Handled" }).disabled).toBe(true);
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "FYI" }).disabled).toBe(true);
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Noise" }).disabled).toBe(true);
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Snooze" }).disabled).toBe(false);
  });

  it("renders nothing when the canonical model exposes no promoted verb", () => {
    render(
      <MobileTriageBar
        actions={resolveReaderActions({ id: "frozen-1" }, { readOnly: true })}
        onAction={() => {}}
        onSnooze={() => {}}
      />,
    );

    expect(screen.queryByTestId("inbox-mobile-triage-bar")).toBeNull();
  });

  it("uses the canonical 44px touch-target token for every action", () => {
    render(
      <MobileTriageBar
        actions={{
          canHandle: true,
          canMoveToFyi: true,
          canMoveToNoise: true,
          showDestructiveActions: true,
        }}
        onAction={() => {}}
        onSnooze={() => {}}
      />,
    );

    for (const button of screen.getAllByRole("button")) {
      expect(button.style.minHeight).toBe("var(--sp-touch-min)");
    }
  });
});
