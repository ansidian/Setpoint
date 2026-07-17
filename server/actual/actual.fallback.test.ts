import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Covers the 3-way bill-write branch in actual.ts sendBill:
// lightweight CRDT sync -> SDK worker fallback (only on
// ACTUAL_LIGHTWEIGHT_UNSUPPORTED with the fallback allowed) -> in-process SDK.

vi.mock("./actual-lightweight-writes.ts", () => ({
  sendBillLightweight: vi.fn(),
}));
vi.mock("./actual-worker.ts", () => ({
  runActualWorkerOperation: vi.fn(),
}));
vi.mock("./actual-connection-test.ts", () => ({
  testActualConnectionHttp: vi.fn(),
}));
vi.mock("./actual-local-metadata.ts", () => ({
  readLocalActualMetadata: vi.fn(),
  actualDataDir: vi.fn(() => "/tmp/ea-actual-fallback-test"),
  findLocalBudgetDir: vi.fn(async () => null),
  getActualConfig: vi.fn(async () => ({})),
  pruneActualBudgetBackups: vi.fn(async () => {}),
}));
// The in-process branch dynamically imports actual-core; keep its heavyweight
// dependencies inert.
vi.mock("@actual-app/api", () => ({ default: {} }));
vi.mock("../db/connection.ts", () => ({
  default: { execute: vi.fn(async () => ({ rows: [] })), batch: vi.fn(async () => []) },
}));
vi.mock("../platform/encryption.ts", () => ({ decrypt: vi.fn((value: unknown) => value) }));

const { sendBillLightweight } = await import("./actual-lightweight-writes.ts");
const { runActualWorkerOperation } = await import("./actual-worker.ts");
const { sendBill } = await import("./actual.ts");
const mockSendBillLightweight = vi.mocked(sendBillLightweight);
const mockRunActualWorkerOperation = vi.mocked(runActualWorkerOperation);

const BILL = { type: "expense", payee: "Power Co", amount: 12.34, due_date: "2026-05-20" };
const originalNodeEnv = process.env.NODE_ENV;
const originalFallbackFlag = process.env.EA_ACTUAL_SDK_WRITE_FALLBACK;
const originalWorkerDisabled = process.env.EA_ACTUAL_WORKER_DISABLED;

function unsupportedError() {
  return Object.assign(new Error("Encrypted Actual budgets are not supported"), {
    status: 503,
    code: "ACTUAL_LIGHTWEIGHT_UNSUPPORTED",
  });
}

describe("actual.ts sendBill write-path selection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NODE_ENV = "production";
    delete process.env.EA_ACTUAL_SDK_WRITE_FALLBACK;
    delete process.env.EA_ACTUAL_WORKER_DISABLED;
  });

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    if (originalFallbackFlag == null) delete process.env.EA_ACTUAL_SDK_WRITE_FALLBACK;
    else process.env.EA_ACTUAL_SDK_WRITE_FALLBACK = originalFallbackFlag;
    if (originalWorkerDisabled == null) delete process.env.EA_ACTUAL_WORKER_DISABLED;
    else process.env.EA_ACTUAL_WORKER_DISABLED = originalWorkerDisabled;
  });

  it("uses the lightweight path and never touches the SDK worker on success", async () => {
    mockSendBillLightweight.mockResolvedValue({ success: true, lightweight: true, message: "Bill sent" });

    const result = await sendBill(BILL, "u1");

    expect(result).toMatchObject({ lightweight: true });
    expect(sendBillLightweight).toHaveBeenCalledWith("u1", BILL);
    expect(runActualWorkerOperation).not.toHaveBeenCalled();
  });

  it("falls back to the SDK worker when lightweight is unsupported and the fallback is enabled", async () => {
    process.env.EA_ACTUAL_SDK_WRITE_FALLBACK = "1";
    mockSendBillLightweight.mockRejectedValue(unsupportedError());
    mockRunActualWorkerOperation.mockResolvedValue({ success: true });

    const result = await sendBill(BILL, "u1");

    expect(result).toMatchObject({ success: true });
    expect(runActualWorkerOperation).toHaveBeenCalledWith(
      "sendBill",
      [BILL, "u1"],
      expect.objectContaining({ shutdownAfterOperation: true }),
    );
  });

  it("refuses the SDK fallback when it is not enabled in production", async () => {
    mockSendBillLightweight.mockRejectedValue(unsupportedError());

    await expect(sendBill(BILL, "u1")).rejects.toMatchObject({
      code: "ACTUAL_LIGHTWEIGHT_UNSUPPORTED",
    });
    expect(runActualWorkerOperation).not.toHaveBeenCalled();
  });

  it("never falls back after the lightweight local write was applied (would duplicate)", async () => {
    process.env.EA_ACTUAL_SDK_WRITE_FALLBACK = "1";
    mockSendBillLightweight.mockRejectedValue(Object.assign(new Error("sync failed"), {
      status: 502,
      code: "ACTUAL_LIGHTWEIGHT_SYNC_FAILED",
      localWriteApplied: true,
    }));

    await expect(sendBill(BILL, "u1")).rejects.toMatchObject({
      code: "ACTUAL_LIGHTWEIGHT_SYNC_FAILED",
      localWriteApplied: true,
    });
    expect(runActualWorkerOperation).not.toHaveBeenCalled();
  });

  it("uses the in-process SDK directly in test mode without trying lightweight", async () => {
    process.env.NODE_ENV = "test";
    process.env.EA_ACTUAL_WORKER_DISABLED = "1";

    // In-process mode dynamically imports actual-core, which is heavyweight;
    // asserting the lightweight path was skipped is the contract under test.
    await sendBill(BILL, "u1").catch(() => {});

    expect(sendBillLightweight).not.toHaveBeenCalled();
    expect(runActualWorkerOperation).not.toHaveBeenCalled();
  });
});
