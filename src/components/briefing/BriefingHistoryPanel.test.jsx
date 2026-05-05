import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import BriefingHistoryPanel from "./BriefingHistoryPanel.jsx";
import { getSnapshotById, getSnapshotHistory } from "../../api";

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

function renderPanel(props = {}) {
  const trigger = document.createElement("button");
  trigger.getBoundingClientRect = () => ({
    bottom: 48,
    right: 240,
    top: 20,
    left: 200,
    width: 40,
    height: 28,
  });
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
  it("renders active and frozen snapshot history", async () => {
    getSnapshotHistory.mockResolvedValue({
      snapshots: [
        {
          id: 1,
          status: "active",
          readOnly: false,
          schedule_label: "Current",
          start_at: "2026-05-05T14:00:00.000Z",
          end_at: "2026-05-06T07:00:00.000Z",
          laneCounts: { needs_attention: 2, fyi: 1, noise: 0, carryover: 0 },
        },
        {
          id: 2,
          status: "frozen",
          readOnly: true,
          schedule_label: "Morning",
          start_at: "2026-05-04T15:00:00.000Z",
          end_at: "2026-05-05T07:00:00.000Z",
          laneCounts: { needs_attention: 0, fyi: 1, noise: 1, carryover: 1 },
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
    getSnapshotHistory.mockResolvedValue({
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
    getSnapshotById.mockResolvedValue({
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
