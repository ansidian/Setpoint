import { useState } from "react";
import { MemoryRouter } from "react-router";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SettingsState } from "../settingsTypes";
import type { ConnectionRowView } from "../connectionModel";

const mockApi = vi.hoisted(() => ({
  getActualMetadata: vi.fn(),
}));

// test-architecture: allow-boundary-mock -- Actual metadata crosses the authenticated provider HTTP boundary while the real Finance controls render.
vi.mock("@/api", () => ({
  getActualMetadata: mockApi.getActualMetadata,
  getUtilityMappings: async () => ({budgetId:"sync-id",metadataAvailable:true,utilities:[],payees:[],schedules:[]}),
}));

const { default: ActualBudgetSettingsSection } = await import("./ActualBudgetSettingsSection");

function actualConnection(): ConnectionRowView {
  return {
    id: "actual-budget",
    group: "data_sources",
    label: "Actual Budget",
    description: "",
    minimumViable: "",
    hash: "actual-budget",
    state: "connected",
    statusLabel: "connected",
    source: "settings",
    mode: "actual_budget",
    identities: [],
    lastTestedAt: null,
    lastSucceededAt: null,
    lastFailedAt: null,
  };
}

const connectedSettings: SettingsState = {
  actual_budget_url: "https://actual.example.test",
  actual_budget_sync_id: "sync-id",
  actual_budget_configured: true,
  financial_profiles: [{
    id: "profile-power", name: "Power profile", enabled: false, budgetId: "sync-id",
    senderAddresses: ["billing@fictional-power.example"], target: { kind: "utility", scheduleId: "schedule-power" },
  }],
};

function renderSection() {
  function Harness() {
    const [settings, setSettings] = useState<SettingsState | null>(connectedSettings);

    return (
      <>
        <button onClick={() => setSettings(current => ({ ...current }))}>Refresh settings snapshot</button>
        <ActualBudgetSettingsSection
          settings={settings}
          setSettings={setSettings}
          patch={() => {}}
          connections={[actualConnection()]}
        />
      </>
    );
  }

  return render(<MemoryRouter initialEntries={["/settings?tab=finance"]}><Harness /></MemoryRouter>);
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ActualBudgetSettingsSection", () => {
  it("stops after a failed automatic read across re-renders and retries only when requested", async () => {
    let failedReads = 0;
    mockApi.getActualMetadata.mockImplementation(() => {
      failedReads += 1;
      return Promise.reject(new Error("Actual worker exited"));
    });
    renderSection();

    await screen.findByRole("button", { name: "Try again" });
    fireEvent.click(screen.getByRole("button", { name: "Refresh settings snapshot" }));
    await act(async () => {});
    // The external read count proves a failed provider boundary cannot create a retry loop.
    expect(failedReads).toBe(1);

    mockApi.getActualMetadata.mockResolvedValue({ schedules: [{ id: "schedule-power", name: "Recovered power bill", type: "bill" }] });
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(screen.getByText("Update Recovered power bill")).toBeTruthy());
  });
});
