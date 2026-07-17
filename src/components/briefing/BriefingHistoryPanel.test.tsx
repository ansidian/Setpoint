import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import BriefingHistoryPanel from "./BriefingHistoryPanel";
import { getSnapshotById, getSnapshotHistory } from "../../api";
import type { ComponentProps } from "react";

vi.mock("../../hooks/useIsMobile", () => ({ default: () => false }));

vi.mock("../../api", async () => {
  const actual = await vi.importActual("../../api");
  return {
    ...actual,
    getSnapshotHistory: vi.fn(),
    getSnapshotById: vi.fn(),
  };
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function mockSnapshotHistory(value: unknown): void {
  vi.mocked(getSnapshotHistory).mockResolvedValue(
    value as Awaited<ReturnType<typeof getSnapshotHistory>>,
  );
}

function mockSnapshotById(value: unknown): void {
  vi.mocked(getSnapshotById).mockResolvedValue(
    value as Awaited<ReturnType<typeof getSnapshotById>>,
  );
}

function renderPanel(props: Partial<ComponentProps<typeof BriefingHistoryPanel>> = {}) {
  const trigger = document.createElement("button");
  trigger.getBoundingClientRect = () => new DOMRect(200, 20, 40, 28);
  document.body.appendChild(trigger);

  const triggerRef = { current: trigger };
  const onSelectSnapshot = vi.fn();
  const onClose = vi.fn();

  render(
    <BriefingHistoryPanel
      activeId={1}
      triggerRef={triggerRef}
      onSelectSnapshot={onSelectSnapshot}
      onClose={onClose}
      {...props}
    />,
  );

  return { onSelectSnapshot, onClose, trigger };
}

describe("BriefingHistoryPanel snapshots", () => {
  it("carries the blocking calendar-hotkey suspension marker while open", async () => {
    mockSnapshotHistory({ snapshots: [] });
    renderPanel();

    // The panel never traps focus, so the calendar's hotkey handler suspends
    // by PRESENCE of this marker — assert the same query the handler runs.
    await waitFor(() => {
      expect(document.querySelector("[data-suspend-calendar-hotkeys='blocking']")).toBeTruthy();
    });
  });

  it("renders active and frozen snapshot history", async () => {
    // Date bucketing, window labels, and item counts are covered in
    // briefingHistoryModel.test.js. This guard checks the panel fetches history
    // once and renders each row's boundary + read-only/active status.
    mockSnapshotHistory({
      snapshots: [
        {
          id: 1,
          status: "active",
          readOnly: false,
          schedule_label: "Current",
          start_at: "2026-05-05T14:00:00.000Z",
          end_at: "2026-05-06T07:00:00.000Z",
        },
        {
          id: 2,
          status: "frozen",
          readOnly: true,
          schedule_label: "Morning",
          start_at: "2026-05-04T15:00:00.000Z",
          end_at: "2026-05-05T07:00:00.000Z",
        },
      ],
    });

    renderPanel();

    expect(await screen.findByText("Snapshots")).toBeTruthy();
    expect(screen.getAllByText("Current").length).toBeGreaterThan(0);
    expect(screen.getByText("Morning")).toBeTruthy();
    expect(screen.getByText("Active")).toBeTruthy();
    expect(screen.getByText("Read-only")).toBeTruthy();
    expect(getSnapshotHistory).toHaveBeenCalledTimes(1);
  });

  it("loads frozen snapshot detail for read-only inbox selection", async () => {
    mockSnapshotHistory({
      snapshots: [
        {
          id: 2,
          status: "frozen",
          readOnly: true,
          schedule_label: "Morning",
          start_at: "2026-05-04T15:00:00.000Z",
          end_at: "2026-05-05T07:00:00.000Z",
          laneCounts: { needs_attention: 0, fyi: 1, noise: 0, carryover: 0 },
        },
      ],
    });
    mockSnapshotById({
      snapshot: { id: 2, status: "frozen" },
      readOnly: true,
      lanes: { needs_attention: [], fyi: [], noise: [] },
      carryover: [],
      filters: { accounts: [], categories: [] },
    });

    const { onSelectSnapshot } = renderPanel({ activeId: 1 });

    fireEvent.click(await screen.findByText("Morning"));

    await waitFor(() => {
      expect(getSnapshotById).toHaveBeenCalledWith(2);
      expect(onSelectSnapshot).toHaveBeenCalledWith(
        expect.objectContaining({ snapshot: { id: 2, status: "frozen" }, readOnly: true }),
        expect.objectContaining({ id: 2, readOnly: true }),
      );
    });
  });
});
