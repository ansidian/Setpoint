import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const workerMock = vi.hoisted(() => ({
  runActualWorkerOperation: vi.fn(),
}));
const connectionTestMock = vi.hoisted(() => ({
  testActualConnectionHttp: vi.fn(),
}));
const localMetadataMock = vi.hoisted(() => ({
  readLocalActualMetadata: vi.fn(),
}));
const lightweightWritesMock = vi.hoisted(() => ({
  sendBillLightweight: vi.fn(),
}));
const occurrencesMock = vi.hoisted(() => ({
  buildBillOccurrencesFromSchedules: vi.fn(() => []),
  isSchedulePaid: vi.fn(),
}));

vi.mock("./actual-worker.ts", () => workerMock);
vi.mock("./actual-connection-test.ts", () => connectionTestMock);
vi.mock("./actual-local-metadata.ts", () => localMetadataMock);
vi.mock("./actual-lightweight-writes.ts", () => lightweightWritesMock);
vi.mock("./actual-bill-occurrences.ts", () => occurrencesMock);

const originalNodeEnv = process.env.NODE_ENV;

describe("Actual worker call options", () => {
  beforeEach(() => {
    vi.resetModules();
    workerMock.runActualWorkerOperation.mockReset();
    workerMock.runActualWorkerOperation.mockResolvedValue({ success: true });
    lightweightWritesMock.sendBillLightweight.mockReset();
    lightweightWritesMock.sendBillLightweight.mockResolvedValue({ success: true, lightweight: true });
    process.env.NODE_ENV = "production";
    delete process.env.EA_ACTUAL_WORKER_DISABLED;
    delete process.env.EA_ACTUAL_SDK_WRITE_FALLBACK;
  });

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    delete process.env.EA_ACTUAL_WORKER_DISABLED;
    delete process.env.EA_ACTUAL_SDK_WRITE_FALLBACK;
  });

  it("runs transaction bill-pay writes through the lightweight path and keeps other writes bounded", async () => {
    const { sendBill, markBillPaid, createQuickTxn } = await import("./actual.ts");

    await sendBill({ type: "expense", amount: 10, due_date: "2026-07-16" }, "u1");
    await markBillPaid("schedule-1", "u1");
    await createQuickTxn("u1", { accountName: "Checking", amount: 10, payee: "Store" });

    expect(lightweightWritesMock.sendBillLightweight).toHaveBeenCalledWith("u1", { type: "expense", amount: 10, due_date: "2026-07-16" });
    expect(workerMock.runActualWorkerOperation).toHaveBeenNthCalledWith(
      1,
      "markBillPaid",
      ["schedule-1", "u1"],
      expect.objectContaining({ shutdownAfterOperation: true, timeoutMs: 45_000 }),
    );
    expect(workerMock.runActualWorkerOperation).toHaveBeenNthCalledWith(
      2,
      "createQuickTxn",
      ["u1", { accountName: "Checking", amount: 10, payee: "Store" }],
      expect.objectContaining({ shutdownAfterOperation: true, timeoutMs: 45_000 }),
    );
  });

  it("refuses SDK fallback for unsupported production bill-pay writes by default", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    lightweightWritesMock.sendBillLightweight.mockRejectedValueOnce(Object.assign(new Error("future schedule"), {
      status: 503,
      code: "ACTUAL_LIGHTWEIGHT_UNSUPPORTED",
    }));
    const { sendBill } = await import("./actual.ts");

    await expect(sendBill({ type: "bill", amount: 10, due_date: "2026-07-16" }, "u1")).rejects.toMatchObject({
      code: "ACTUAL_LIGHTWEIGHT_UNSUPPORTED",
    });
    expect(workerMock.runActualWorkerOperation).not.toHaveBeenCalled();
  });

  it("can opt into SDK fallback for unsupported production bill-pay writes", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    process.env.EA_ACTUAL_SDK_WRITE_FALLBACK = "1";
    lightweightWritesMock.sendBillLightweight.mockRejectedValueOnce(Object.assign(new Error("future schedule"), {
      status: 503,
      code: "ACTUAL_LIGHTWEIGHT_UNSUPPORTED",
    }));
    const { sendBill } = await import("./actual.ts");

    await sendBill({ type: "bill", amount: 10, due_date: "2026-07-16" }, "u1");

    expect(workerMock.runActualWorkerOperation).toHaveBeenCalledWith(
      "sendBill",
      [{ type: "bill", amount: 10, due_date: "2026-07-16" }, "u1"],
      expect.objectContaining({ shutdownAfterOperation: true, timeoutMs: 45_000 }),
    );
  });
});
