import { StrictMode, useState } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import type { SettingsPatch, SettingsState } from "../settingsTypes";
import type { ConnectionRowView, ConnectionState } from "../connectionModel";

const mockApi = vi.hoisted(() => ({
  getActualMetadata: vi.fn(),
  getActualCacheStatus: vi.fn(),
  hydrateActualBudgetCache: vi.fn(),
  resolveBillPayMappingSample: vi.fn(),
  testActualBudget: vi.fn(),
  updateSettings: vi.fn(),
  getTransactionImportMappings: vi.fn(),
  listTransactionImportRuns: vi.fn(),
  getTransactionImportRun: vi.fn(),
}));

// test-architecture: allow-boundary-mock -- Actual metadata, mapping diagnostics, and transaction-import reads cross authenticated provider/storage HTTP boundaries while the real Finance controls render.
vi.mock("@/api", () => ({
  getActualMetadata: mockApi.getActualMetadata,
  getActualCacheStatus: mockApi.getActualCacheStatus,
  hydrateActualBudgetCache: mockApi.hydrateActualBudgetCache,
  resolveBillPayMappingSample: mockApi.resolveBillPayMappingSample,
  testActualBudget: mockApi.testActualBudget,
  updateSettings: mockApi.updateSettings,
  getTransactionImportMappings: mockApi.getTransactionImportMappings,
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
      bill_pay_mappings: { version: 1, profiles: [] },
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
  mockApi.resolveBillPayMappingSample.mockResolvedValue({
    bill: {
      payee: "Citi",
      amount: 25,
      due_date: "2026-05-15",
      type: "expense",
      account_label: "Visa",
      category_label: "Gas",
    },
    mapping: {
      status: "matched",
      profileId: "profile-citi",
      behaviorId: "minimum-due",
      amountSource: "minimum_due",
      matchedProfiles: ["profile-citi"],
    },
  });
  mockApi.getTransactionImportMappings.mockResolvedValue([]);
  mockApi.listTransactionImportRuns.mockResolvedValue({ runs: [] });
  mockApi.getTransactionImportRun.mockResolvedValue(null);
});

describe("ActualBudgetSettingsSection", () => {
  it("shows one Actual setup prompt and hides Finance customization when disconnected", () => {
    renderSection({ state: "not_connected" });

    expect(screen.getByText("Connect Actual Budget")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Set up Actual Budget" }).getAttribute("href"))
      .toBe("/settings?tab=connections#actual-budget");
    expect(screen.queryByText("Bill Pay Mappings")).toBeNull();
    expect(screen.queryByText("Mapping Test")).toBeNull();
    expect(screen.queryByText("Utility Pay Links")).toBeNull();
    expect(screen.queryByText("Email Transaction Imports")).toBeNull();
  });

  it("shows full Finance controls when Actual is connected", () => {
    renderSection({ state: "connected" });

    expect(screen.getByText("Bill Pay Mappings")).toBeTruthy();
    expect(screen.getByText("Mapping Test")).toBeTruthy();
    expect(screen.getByText("Utility Pay Links")).toBeTruthy();
    expect(screen.queryByText("Actual Budget needs attention")).toBeNull();
  });

  it("restores persisted transaction-import account labels on a fresh visit", async () => {
    mockApi.getTransactionImportMappings.mockResolvedValueOnce([{
      source: "amazon",
      mode: "automatic",
      actualAccountId: "acct-visa",
      actualCategoryId: null,
      createdAt: 1,
      updatedAt: 2,
    }]);

    renderSection();

    const account = await screen.findByLabelText<HTMLButtonElement>("Amazon Actual account");
    await waitFor(() => expect(account.textContent).toContain("Visa"));
  });

  it("retains Finance settings but disables live operations while Actual needs attention", () => {
    renderSection({
      state: "needs_attention",
      initialSettings: {
        bill_pay_mappings: { version: 1, profiles: [] },
        utility_pay_links: [{
          scheduleId: "schedule-electric",
          label: "Electric",
          url: "https://utility.example.test",
        }],
      },
    });

    expect(screen.getByText("Actual Budget needs attention")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Repair connection" }).getAttribute("href"))
      .toBe("/settings?tab=connections#actual-budget");
    expect(screen.getByText("Bill Pay Mappings")).toBeTruthy();
    expect(screen.getByText("Utility Pay Links")).toBeTruthy();
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Run Test" }).disabled).toBe(true);
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Schedule for pay link" }).disabled).toBe(true);
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "+ Add pay link" }).disabled).toBe(true);
    expect(screen.getByDisplayValue<HTMLInputElement>("https://utility.example.test").disabled).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: /profile/i }));
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Payee" }).disabled).toBe(true);
  });

  it("keeps Actual connection controls out of Finance while retaining mapping controls", async () => {
    renderSection();

    expect(screen.queryByDisplayValue("https://actual.example.test")).toBeNull();
    expect(await screen.findByText("Bill Pay Mappings")).toBeTruthy();
    expect(screen.getByText("Utility Pay Links")).toBeTruthy();
  });

  it("keeps a stale Actual target visible by its stored label", async () => {
    renderSection({
      initialSettings: {
        bill_pay_mappings: {
          version: 1,
          profiles: [
            {
              id: "profile-1",
              name: "Old profile",
              enabled: false,
              identity: { domain: ["old.example"] },
              behaviors: [
                {
                  id: "behavior-1",
                  name: "Old behavior",
                  enabled: false,
                  type: "expense",
                  intent: { subject: ["due"] },
                  targets: {
                    payee_id: "payee-old",
                    payee_label: "Old Payee",
                  },
                },
              ],
            },
          ],
        },
      },
    });

    fireEvent.click(await screen.findByRole("button", { name: "Expand profile 1" }));

    expect(await screen.findByText("Old Payee")).toBeTruthy();
  });

  it("still loads Actual metadata after interaction under StrictMode", async () => {
    // Regression: the section's mount guard must reset to true on (re)mount so
    // StrictMode's mount → cleanup → remount does not leave it permanently false,
    // which would silently drop every metadata state update (stuck "Loading…").
    renderSection({ strict: true });

    fireEvent.click(await screen.findByRole("button", { name: /profile/i }));
    fireEvent.click(await screen.findByRole("button", { name: "Payee" }));

    expect(await screen.findByRole("option", { name: "Citi" })).toBeTruthy();
  });

  it("surfaces metadata load failures instead of presenting an ordinary empty mapping list", async () => {
    mockApi.getActualMetadata.mockRejectedValueOnce(new Error("Actual worker exited"));
    renderSection();

    fireEvent.click(await screen.findByRole("button", { name: /profile/i }));

    expect(await screen.findByText("Metadata unavailable")).toBeTruthy();
    expect(screen.getByText(/Actual metadata could not load/i)).toBeTruthy();
  });

  it("defaults mapping profiles to collapsed and supports expanding them", async () => {
    renderSection({
      initialSettings: {
        bill_pay_mappings: {
          version: 1,
          profiles: [{
            id: "profile-1",
            name: "Citi",
            enabled: true,
            identity: { domain: ["citi.com"] },
            behaviors: [{
              id: "behavior-1",
              name: "Transaction",
              enabled: true,
              type: "expense",
              intent: { subject: ["transaction"] },
              targets: { payee_id: "payee-citi", payee_label: "Citi" },
            }],
          }],
        },
      },
    });

    expect(await screen.findByText("1 behavior")).toBeTruthy();
    expect(screen.queryByText("citi.com")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Expand profile 1" }));

    expect(await screen.findByText("citi.com")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Collapse profile 1" }));

    expect(screen.queryByText("citi.com")).toBeNull();
  });

  it("submits pasted mapping samples and renders diagnostics", async () => {
    const mappings = {
      version: 1,
      profiles: [
        {
          id: "profile-citi",
          name: "Citi",
          enabled: true,
          identity: { domain: ["citi.com"] },
          behaviors: [
            {
              id: "minimum-due",
              name: "Minimum due",
              enabled: true,
              type: "expense",
              intent: { subject: ["payment due"] },
              targets: { payee_id: "payee-citi", payee_label: "Citi" },
            },
          ],
        },
      ],
    } as NonNullable<SettingsState["bill_pay_mappings"]>;

    renderSection({ initialSettings: { bill_pay_mappings: mappings } });

    fireEvent.change(await screen.findByPlaceholderText("sample@billing.example.com"), {
      target: { value: "alerts@citi.com" },
    });
    fireEvent.change(screen.getByPlaceholderText("Your payment is due"), {
      target: { value: "Payment due" },
    });
    fireEvent.change(screen.getByPlaceholderText("Paste the relevant bill text here."), {
      target: { value: "Minimum due: $25" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Run Test" }));

    await waitFor(() => {
      // test-architecture: allow-boundary-interaction -- the pasted email and complete mapping tree are outbound Actual diagnostic inputs not present in the normalized match result.
      expect(mockApi.resolveBillPayMappingSample).toHaveBeenCalledWith(expect.objectContaining({
        email: {
          from: "alerts@citi.com",
          subject: "Payment due",
          body: "Minimum due: $25",
          snippet: "Minimum due: $25",
        },
        mappings: expect.objectContaining({
          version: 1,
          profiles: [expect.objectContaining({
            id: "profile-citi",
            identity: expect.objectContaining({ domain: ["citi.com"] }),
            behaviors: [expect.objectContaining({
              id: "minimum-due",
              intent: expect.objectContaining({ subject: ["payment due"] }),
            })],
          })],
        }),
      }));
    });
    expect(await screen.findByText("Matched")).toBeTruthy();
    expect(screen.getByText("Profile profile-citi")).toBeTruthy();
    expect(screen.getByText("Behavior minimum-due")).toBeTruthy();
    expect(screen.getByText("Amount minimum_due")).toBeTruthy();
    expect(screen.getByText("Identity matches: profile-citi")).toBeTruthy();
    expect(screen.getByText("Gas")).toBeTruthy();
    expect(screen.queryByText("From account")).toBeNull();
    expect(screen.queryByText("To account")).toBeNull();
  });
});
