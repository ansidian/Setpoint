import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Actual Budget lightweight wire and worker process are provider/process
// boundaries here: the tests inject compatibility outcomes and assert the
// facade result, while durable local-write evidence lives in the slow fixture.
// test-architecture: allow-boundary-mock -- Actual Budget lightweight wire and worker process boundaries are injected to produce unsupported, success, and sync-failure outcomes without asserting routing.
vi.mock("./actual-lightweight-writes.ts", () => ({
  sendBillLightweight: vi.fn(),
}));
// test-architecture: allow-boundary-mock -- The forked Actual SDK worker is a process boundary; only its returned result/error matters to this facade behavior suite.
vi.mock("./actual-worker.ts", () => ({
  runActualWorkerOperation: vi.fn(),
}));

const { sendBillLightweight } = await import("./actual-lightweight-writes.ts");
const { runActualWorkerOperation } = await import("./actual-worker.ts");
const { sendBill } = await import("./actual.ts");
const mockSendBillLightweight = vi.mocked(sendBillLightweight);
const mockRunActualWorkerOperation = vi.mocked(runActualWorkerOperation);

const BILL = { type: "expense", payee: "Power Co", amount: 12.34, due_date: "2026-05-20" };
const originalNodeEnv = process.env.NODE_ENV;
const originalFallbackFlag = process.env.EA_ACTUAL_SDK_WRITE_FALLBACK;

function unsupportedError() {
  return Object.assign(new Error("Encrypted Actual budgets are not supported"), {
    status: 503,
    code: "ACTUAL_LIGHTWEIGHT_UNSUPPORTED",
  });
}

describe("actual.ts sendBill compatibility outcomes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NODE_ENV = "production";
    delete process.env.EA_ACTUAL_SDK_WRITE_FALLBACK;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.env.NODE_ENV = originalNodeEnv;
    if (originalFallbackFlag == null) delete process.env.EA_ACTUAL_SDK_WRITE_FALLBACK;
    else process.env.EA_ACTUAL_SDK_WRITE_FALLBACK = originalFallbackFlag;
  });

  it("returns the lightweight provider result when the write succeeds", async () => {
    mockSendBillLightweight.mockResolvedValue({
      success: true,
      lightweight: true,
      message: "Bill sent",
      transactionId: "lightweight-1",
    });

    await expect(sendBill(BILL, "u1")).resolves.toEqual({
      success: true,
      lightweight: true,
      message: "Bill sent",
      transactionId: "lightweight-1",
    });
  });

  it("returns the compatible worker result when lightweight support is unavailable", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    process.env.EA_ACTUAL_SDK_WRITE_FALLBACK = "1";
    mockSendBillLightweight.mockRejectedValue(unsupportedError());
    mockRunActualWorkerOperation.mockResolvedValue({ success: true, transactionId: "worker-1" });

    await expect(sendBill(BILL, "u1")).resolves.toEqual({
      success: true,
      transactionId: "worker-1",
    });
  });

  it("surfaces the unsupported error when no compatible fallback is enabled", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mockSendBillLightweight.mockRejectedValue(unsupportedError());

    await expect(sendBill(BILL, "u1")).rejects.toMatchObject({
      code: "ACTUAL_LIGHTWEIGHT_UNSUPPORTED",
    });
  });

  it("preserves the local-write-applied error so callers cannot retry a duplicate", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
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
  });

  it("surfaces a worker timeout after an unsupported lightweight result", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    process.env.EA_ACTUAL_SDK_WRITE_FALLBACK = "1";
    mockSendBillLightweight.mockRejectedValue(unsupportedError());
    mockRunActualWorkerOperation.mockRejectedValue(Object.assign(new Error("worker timed out"), {
      status: 504,
      code: "ACTUAL_WORKER_TIMEOUT",
    }));

    await expect(sendBill(BILL, "u1")).rejects.toMatchObject({
      status: 504,
      code: "ACTUAL_WORKER_TIMEOUT",
    });
  });
});
