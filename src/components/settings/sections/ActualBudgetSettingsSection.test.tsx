import { StrictMode, useState } from "react";
import { MemoryRouter } from "react-router";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import type { SettingsPatch, SettingsState } from "../settingsTypes";
import type { ConnectionRowView, ConnectionState } from "../connectionModel";
import type { ActualMetadataResponse } from "../../../../shared/types/bills";

const mockApi = vi.hoisted(() => ({
  getActualMetadata: vi.fn(),
  getActualCacheStatus: vi.fn(),
  hydrateActualBudgetCache: vi.fn(),
  testActualBudget: vi.fn(),
  updateSettings: vi.fn(),
}));

// test-architecture: allow-boundary-mock -- Actual metadata and transaction-import reads cross authenticated provider/storage HTTP boundaries while the real Finance controls render.
vi.mock("@/api", () => ({
  getActualMetadata: mockApi.getActualMetadata,
  getUtilityMappings: async () => ({budgetId:"sync-id",metadataAvailable:true,utilities:[],payees:[],schedules:[]}),
  getActualCacheStatus: mockApi.getActualCacheStatus,
  hydrateActualBudgetCache: mockApi.hydrateActualBudgetCache,
  testActualBudget: mockApi.testActualBudget,
  updateSettings: mockApi.updateSettings,
}));

const { default: ActualBudgetSettingsSection } = await import("./ActualBudgetSettingsSection");

function actualConnection(state: ConnectionState): ConnectionRowView {
  return {
    id: "actual-budget",
    group: "data_sources",
    label: "Actual Budget",
    description: "",
    minimumViable: "",
    hash: "actual-budget",
    state,
    statusLabel: state,
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

function deferredMetadata() {
  let resolve!: (metadata: ActualMetadataResponse) => void;
  const promise = new Promise<ActualMetadataResponse>(settle => { resolve = settle; });
  return { promise, resolve };
}

function renderSection({ initialSettings, replacementSettings, patch = vi.fn<SettingsPatch>(), strict = false, state = "connected" }: {
  initialSettings?: SettingsState;
  replacementSettings?: SettingsState;
  patch?: Mock<SettingsPatch>;
  strict?: boolean;
  state?: ConnectionState;
} = {}) {
  function Harness() {
    const [settings, setSettings] = useState<SettingsState | null>(initialSettings || connectedSettings);

    return (
      <>
        <button onClick={() => setSettings(current => ({ ...current }))}>Refresh settings snapshot</button>
        {replacementSettings ? <button onClick={() => setSettings(replacementSettings)}>Change connected budget</button> : null}
        <ActualBudgetSettingsSection
          settings={settings}
          setSettings={setSettings}
          patch={patch}
          connections={[actualConnection(state)]}
        />
      </>
    );
  }

  return {
    patch,
    ...render(<MemoryRouter initialEntries={["/settings?tab=finance"]}>{strict ? <StrictMode><Harness /></StrictMode> : <Harness />}</MemoryRouter>),
  };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

beforeEach(() => {
  mockApi.getActualMetadata.mockResolvedValue({
    accounts: [
      { id: "acct-checking", name: "Checking" },
      { id: "acct-visa", name: "Visa" },
    ],
    payees: [{ id: "payee-citi", name: "Citi" }],
    categories: [
      {
        group_name: "Bills",
        categories: [{ id: "cat-card", name: "Credit Card Payments" }],
      },
    ],
    schedules: [{ id: "schedule-power", name: "Power bill", type: "bill" }],
  });
  mockApi.testActualBudget.mockResolvedValue({ success: true });
  mockApi.updateSettings.mockResolvedValue({ success: true });
  mockApi.getActualCacheStatus.mockResolvedValue({
    success: true,
    configured: true,
    hydrated: false,
    message: "Actual local budget cache not found",
  });
  mockApi.hydrateActualBudgetCache.mockResolvedValue({
    success: true,
    hydrated: true,
    budgetId: "My-Finances-d8e502a",
    dbSizeBytes: 50_000_000,
    backupCount: 1,
  });
});

describe("ActualBudgetSettingsSection", () => {
  it("automatically loads and shares Actual metadata under StrictMode", async () => {
    // Regression: the section's mount guard must reset to true on (re)mount so
    // StrictMode's mount → cleanup → remount does not leave it permanently false,
    // which would silently drop every metadata state update (stuck "Loading…").
    renderSection({ strict: true });

    expect(await screen.findByText("Update Power bill")).toBeTruthy();
    fireEvent.click(await screen.findByRole("button", { name: "+ Add pay link" }));
    fireEvent.click(await screen.findByRole("button", { name: "Schedule for pay link" }));

    expect(await screen.findByText("Power bill")).toBeTruthy();
  });

  it("stops after a failed automatic read across re-renders and retries only when requested", async () => {
    let failedReads = 0;
    mockApi.getActualMetadata.mockImplementation(() => {
      failedReads += 1;
      return Promise.reject(new Error("Actual worker exited"));
    });
    renderSection();

    const failure = "Couldn’t load Actual targets. Try again or repair the Actual Budget connection.";
    expect(await screen.findByText(failure)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Refresh settings snapshot" }));
    fireEvent.click(screen.getByRole("button", { name: "Edit Power profile" }));
    await act(async () => {});
    // The external read count proves a failed provider boundary cannot create a retry loop.
    expect(failedReads).toBe(1);

    mockApi.getActualMetadata.mockResolvedValue({ schedules: [{ id: "schedule-power", name: "Recovered power bill", type: "bill" }] });
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Utility schedule" }).textContent).toContain("Recovered power bill"));
    expect(screen.queryByText(failure)).toBeNull();
  });

  it("keeps a late previous-budget response out of the current profile targets", async () => {
    const previous = deferredMetadata();
    const current = deferredMetadata();
    mockApi.getActualMetadata.mockReturnValueOnce(previous.promise).mockReturnValueOnce(current.promise);
    renderSection({
      replacementSettings: {
        ...connectedSettings, actual_budget_sync_id: "second-budget",
        financial_profiles: [{ ...connectedSettings.financial_profiles![0]!, budgetId: "second-budget" }],
      },
    });

    fireEvent.click(screen.getByRole("button", { name: "Change connected budget" }));
    await act(async () => current.resolve({ schedules: [{ id: "schedule-power", name: "Current budget bill", type: "bill" }] }));
    expect(await screen.findByText("Update Current budget bill")).toBeTruthy();
    await act(async () => previous.resolve({ schedules: [{ id: "schedule-power", name: "Previous budget bill", type: "bill" }] }));

    fireEvent.click(screen.getByRole("button", { name: "Edit Power profile" }));
    fireEvent.click(screen.getByRole("button", { name: "Utility schedule" }));
    expect(await screen.findByRole("option", { name: "Current budget bill" })).toBeTruthy();
    expect(screen.queryByText(/Previous budget bill/)).toBeNull();
  });
});
