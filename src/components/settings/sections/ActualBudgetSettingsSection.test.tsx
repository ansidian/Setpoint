import { StrictMode, useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import type { SettingsPatch, SettingsState } from "../settingsTypes";
import type { ConnectionRowView, ConnectionState } from "../connectionModel";

const mockApi = vi.hoisted(() => ({
  getActualMetadata: vi.fn(),
  getActualCacheStatus: vi.fn(),
  hydrateActualBudgetCache: vi.fn(),
  testActualBudget: vi.fn(),
  updateSettings: vi.fn(),
  listTransactionImportRuns: vi.fn(),
  getTransactionImportRun: vi.fn(),
}));

// test-architecture: allow-boundary-mock -- Actual metadata and transaction-import reads cross authenticated provider/storage HTTP boundaries while the real Finance controls render.
vi.mock("@/api", () => ({
  getActualMetadata: mockApi.getActualMetadata,
  getActualCacheStatus: mockApi.getActualCacheStatus,
  hydrateActualBudgetCache: mockApi.hydrateActualBudgetCache,
  testActualBudget: mockApi.testActualBudget,
  updateSettings: mockApi.updateSettings,
  listTransactionImportRuns: mockApi.listTransactionImportRuns,
  getTransactionImportRun: mockApi.getTransactionImportRun,
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

function renderSection({ initialSettings, patch = vi.fn<SettingsPatch>(), strict = false, state = "connected" }: {
  initialSettings?: SettingsState;
  patch?: Mock<SettingsPatch>;
  strict?: boolean;
  state?: ConnectionState;
} = {}) {
  function Harness() {
    const [settings, setSettings] = useState<SettingsState | null>(initialSettings || {
      actual_budget_url: "https://actual.example.test",
      actual_budget_sync_id: "sync-id",
      actual_budget_configured: true,
    });

    return (
      <ActualBudgetSettingsSection
        settings={settings}
        setSettings={setSettings}
        patch={patch}
        connections={[actualConnection(state)]}
        accounts={[]}
      />
    );
  }

  return {
    patch,
    ...render(strict ? <StrictMode><Harness /></StrictMode> : <Harness />),
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
  mockApi.listTransactionImportRuns.mockResolvedValue({ runs: [] });
  mockApi.getTransactionImportRun.mockResolvedValue(null);
});

describe("ActualBudgetSettingsSection", () => {
  it("still loads Actual metadata after interaction under StrictMode", async () => {
    // Regression: the section's mount guard must reset to true on (re)mount so
    // StrictMode's mount → cleanup → remount does not leave it permanently false,
    // which would silently drop every metadata state update (stuck "Loading…").
    renderSection({ strict: true });

    fireEvent.click(await screen.findByRole("button", { name: "+ Add pay link" }));
    fireEvent.click(await screen.findByRole("button", { name: "Schedule for pay link" }));

    expect(await screen.findByText("Power bill")).toBeTruthy();
  });

  it("surfaces metadata load failures in active Finance controls", async () => {
    mockApi.getActualMetadata.mockRejectedValueOnce(new Error("Actual worker exited"));
    renderSection();

    fireEvent.click(await screen.findByRole("button", { name: "+ Add pay link" }));

    expect(await screen.findByText("Actual worker exited")).toBeTruthy();
  });
});
