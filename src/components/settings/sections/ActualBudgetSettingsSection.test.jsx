import { useState } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockApi = vi.hoisted(() => ({
  getActualMetadata: vi.fn(),
  resolveBillPayMappingSample: vi.fn(),
  testActualBudget: vi.fn(),
  updateSettings: vi.fn(),
}));

vi.mock("@/api", () => ({
  getActualMetadata: mockApi.getActualMetadata,
  resolveBillPayMappingSample: mockApi.resolveBillPayMappingSample,
  testActualBudget: mockApi.testActualBudget,
  updateSettings: mockApi.updateSettings,
}));

vi.mock("@/components/shared/SearchableDropdown", () => ({
  default: function SearchableDropdownMock({ options, value, onChange, placeholder, ariaLabel }) {
    return (
      <select
        aria-label={ariaLabel || placeholder}
        value={value || ""}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">{placeholder}</option>
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.name}
          </option>
        ))}
      </select>
    );
  },
}));

const { default: ActualBudgetSettingsSection } = await import("./ActualBudgetSettingsSection.jsx");

function renderSection({ initialSettings, patch = vi.fn() } = {}) {
  function Harness() {
    const [settings, setSettings] = useState(initialSettings || {
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
      />
    );
  }

  return {
    patch,
    ...render(<Harness />),
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
});

describe("ActualBudgetSettingsSection", () => {
  it("owns the moved Actual connection controls", async () => {
    renderSection();

    expect(await screen.findByDisplayValue("https://actual.example.test")).toBeTruthy();
    expect(screen.getByDisplayValue("sync-id")).toBeTruthy();

    fireEvent.change(screen.getByDisplayValue("sync-id"), {
      target: { value: "new-sync" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(mockApi.updateSettings).toHaveBeenCalledWith({
        actual_budget_url: "https://actual.example.test",
        actual_budget_sync_id: "new-sync",
      });
    });
  });

  it("builds a mapping payload with matcher chips and Actual target labels", async () => {
    const { patch } = renderSection();

    await screen.findByText("Bill Pay Mappings");
    fireEvent.click(screen.getByRole("button", { name: /profile/i }));

    fireEvent.change(screen.getByLabelText("Profile 1 name"), {
      target: { value: "Citi Costco" },
    });
    fireEvent.change(screen.getByPlaceholderText("example.com"), {
      target: { value: "citi.com" },
    });
    fireEvent.keyDown(screen.getByPlaceholderText("example.com"), {
      key: "Enter",
      code: "Enter",
    });
    fireEvent.change(screen.getByPlaceholderText("payment due"), {
      target: { value: "payment due" },
    });
    fireEvent.keyDown(screen.getByPlaceholderText("payment due"), {
      key: "Enter",
      code: "Enter",
    });

    const enabledToggles = screen.getAllByLabelText("Enabled");
    fireEvent.click(enabledToggles[0]);
    fireEvent.click(enabledToggles[1]);
    fireEvent.change(screen.getByLabelText("Payee"), { target: { value: "payee-citi" } });
    fireEvent.change(screen.getByLabelText("Account"), { target: { value: "acct-checking" } });
    fireEvent.change(screen.getByLabelText("Category"), { target: { value: "cat-card" } });

    await waitFor(() => {
      const lastPayload = patch.mock.calls.at(-1)?.[0]?.bill_pay_mappings;
      expect(lastPayload?.profiles[0]).toMatchObject({
        name: "Citi Costco",
        enabled: true,
        identity: { domain: ["citi.com"] },
      });
      expect(lastPayload.profiles[0].behaviors[0]).toMatchObject({
        enabled: true,
        intent: { subject: ["payment due"] },
        targets: {
          payee_id: "payee-citi",
          payee_label: "Citi",
          account_id: "acct-checking",
          account_label: "Checking",
          category_id: "cat-card",
          category_label: "Credit Card Payments",
        },
      });
    });
  });

  it("keeps stale Actual target IDs visible as missing choices", async () => {
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
    expect(screen.getByText("Payee missing: Old Payee")).toBeTruthy();
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
    };

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
      expect(mockApi.resolveBillPayMappingSample).toHaveBeenCalledWith(expect.objectContaining({
        email: {
          from: "alerts@citi.com",
          subject: "Payment due",
          body: "Minimum due: $25",
          snippet: "Minimum due: $25",
        },
      }));
    });
    expect(mockApi.resolveBillPayMappingSample.mock.calls[0][0]).not.toHaveProperty("candidate");
    const submitted = mockApi.resolveBillPayMappingSample.mock.calls[0][0];
    expect(submitted.mappings.profiles[0]).toMatchObject({
      id: "profile-citi",
      identity: { domain: ["citi.com"] },
    });
    expect(submitted.mappings.profiles[0].behaviors[0]).toMatchObject({
      id: "minimum-due",
      intent: { subject: ["payment due"] },
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
