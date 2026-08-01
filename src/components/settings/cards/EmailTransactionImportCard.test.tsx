import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  getTransactionImportMappings: vi.fn(),
  listTransactionImportRuns: vi.fn(),
  getTransactionImportRun: vi.fn(),
  updateTransactionImportMapping: vi.fn(),
  startTransactionImportScan: vi.fn(),
  commitTransactionImportItems: vi.fn(),
  retryTransactionImportItem: vi.fn(),
  dismissTransactionImportItem: vi.fn(),
}));

vi.mock("@/api", () => api);
vi.mock("@/components/ui/select", () => import("../shared/selectMock.test-utils"));
vi.mock("./transaction-import/TransactionImportDateField", () => ({
  default: ({
    value,
    onChange,
    ariaLabel,
    disabled,
  }: {
    value: string;
    onChange: (value: string) => void;
    ariaLabel: string;
    disabled?: boolean;
  }) => (
    <input
      type="date"
      aria-label={ariaLabel}
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
    />
  ),
}));

const { default: EmailTransactionImportCard } = await import("./EmailTransactionImportCard");

function renderCard(liveOperationsAvailable = true) {
  return render(
    <MemoryRouter>
      <EmailTransactionImportCard
        metadata={{
          accounts: [{ id: "actual-1", name: "Everyday Card" }],
          categories: [{ group_name: "Shopping", categories: [{ id: "category-1", name: "Online" }] }],
        }}
        metadataLoading={false}
        onRequestMetadata={vi.fn()}
        gmailAccounts={[{
          id: "gmail-1",
          type: "gmail",
          email: "owner@example.test",
          label: "Personal",
          color: null,
          icon: null,
          calendar_enabled: 1,
          sort_order: 0,
          created_at: "2026-01-01",
          needs_reauth: false,
        }]}
        liveOperationsAvailable={liveOperationsAvailable}
      />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  api.getTransactionImportMappings.mockResolvedValue([{
    source: "amazon",
    mode: "observe",
    actualAccountId: "actual-1",
    actualCategoryId: null,
    createdAt: 1,
    updatedAt: 1,
  }]);
  api.listTransactionImportRuns.mockResolvedValue({ runs: [] });
  api.updateTransactionImportMapping.mockImplementation(async (source, mapping) => ({
    source, ...mapping, createdAt: 1, updatedAt: 2,
  }));
  api.startTransactionImportScan.mockResolvedValue({ runId: "run-1", created: true });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("EmailTransactionImportCard", () => {
  it("makes observe mode's no-write behavior explicit and confirms automatic opt-in", async () => {
    const confirm = vi.fn(() => true);
    vi.stubGlobal("confirm", confirm);
    renderCard();

    expect(await screen.findByText(/Observe only checks Actual/i)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Amazon import mode"), { target: { value: "automatic" } });

    await waitFor(() => expect(api.updateTransactionImportMapping).toHaveBeenCalledWith("amazon", {
      mode: "automatic",
      actualAccountId: "actual-1",
      actualCategoryId: null,
    }));
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("without another click"));
  });

  it("starts a bounded scan once Gmail account, source, and dates are present", async () => {
    renderCard();
    const start = screen.getByLabelText("Start date") as HTMLInputElement;
    const end = screen.getByLabelText("End date") as HTMLInputElement;
    fireEvent.change(start, { target: { value: "2026-07-01" } });
    fireEvent.change(end, { target: { value: "2026-07-22" } });
    fireEvent.click(screen.getByRole("button", { name: "Start backfill" }));

    await waitFor(() => expect(api.startTransactionImportScan).toHaveBeenCalledWith({
      gmailAccountIds: ["gmail-1"],
      sources: ["amazon", "paypal"],
      startDate: "2026-07-01",
      endDate: "2026-07-22",
    }));
  });

  it("retains readable configuration while disabling live operations", async () => {
    renderCard(false);
    expect((await screen.findByLabelText("Amazon import mode") as HTMLSelectElement).disabled).toBe(true);
    expect((screen.getByLabelText("Amazon Actual account") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText("Start date") as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Start backfill" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
