import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import MobileTriageBar from "./MobileTriageBar";
import { resolveReaderActions } from "./readerActionsModel";

afterEach(cleanup);

describe("MobileTriageBar", () => {
  it("offers the five primary snapshot verbs as exact one-tap commands", () => {
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

    expect(screen.getAllByRole("button").map((button) => button.textContent)).toEqual([
      "Handled",
      "FYI",
      "Noise",
      "Snooze",
      "Trash",
    ]);

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
});
