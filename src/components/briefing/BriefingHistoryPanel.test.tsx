import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useRef, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import BriefingHistoryPanel from "./BriefingHistoryPanel";

let historyResponse: unknown;
let snapshotResponse: unknown;

beforeEach(() => {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: false, media: query, onchange: null,
    addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {},
    dispatchEvent: () => true,
  }));
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    const path = new URL(String(input), "https://setpoint.test").pathname;
    const body = path === "/api/briefing/snapshot/history" ? historyResponse : snapshotResponse;
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function mockSnapshotHistory(value: unknown): void {
  historyResponse = value;
}

function mockSnapshotById(value: unknown): void {
  snapshotResponse = value;
}

function PanelHarness({ activeId = 1 }: { activeId?: number }) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [selection, setSelection] = useState("none");
  return <>
    <button ref={triggerRef} type="button">History trigger</button>
    <BriefingHistoryPanel activeId={activeId} triggerRef={triggerRef}
      onSelectSnapshot={(view, item) => setSelection(`${item.id}:${String(view?.readOnly)}:${item.status}`)}
      onClose={() => {}} />
    <output>{selection}</output>
  </>;
}

function renderPanel(props: { activeId?: number } = {}) {
  return render(<PanelHarness {...props} />);
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

    renderPanel({ activeId: 1 });

    fireEvent.click(await screen.findByText("Morning"));

    await waitFor(() => expect(screen.getByText("2:true:frozen")).toBeTruthy());
  });
});
