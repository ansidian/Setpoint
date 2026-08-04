import { cleanup, render, screen } from "@testing-library/react";
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

// test-architecture: allow-boundary-mock -- transaction-import mappings, scans, and financial review mutations cross the authenticated durable HTTP boundary while the real controls render.
vi.mock("@/api", () => api);

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
  it("makes observe mode's no-write behavior explicit", async () => {
    renderCard();

    expect(await screen.findByText(/Observe only checks Actual/i)).toBeTruthy();
  });

  it("retains readable configuration while disabling live operations", async () => {
    renderCard(false);
    expect((await screen.findByLabelText("Amazon import mode") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText("Amazon Actual account") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText("Start date") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Start backfill" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
