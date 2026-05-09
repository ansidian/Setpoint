import * as actualCore from "./actual-core.js";

const OPERATIONS = new Set([
  "testConnection",
  "getMetadata",
  "getAccounts",
  "getRecentTransactions",
  "getPayees",
  "getCategories",
  "getUpcomingBills",
  "getCalendarBillsRange",
  "markBillPaid",
  "sendBill",
  "createQuickTxn",
]);

function serializeError(error) {
  return {
    name: error?.name || "Error",
    message: error?.message || String(error),
    status: error?.status || null,
    code: error?.code || null,
    stack: process.env.NODE_ENV === "production" ? null : error?.stack || null,
  };
}

function sendAndExit(payload, exitCode = 0) {
  if (typeof process.send !== "function") {
    process.exit(exitCode);
    return;
  }
  process.send(payload, () => {
    process.exit(exitCode);
  });
}

process.on("message", async (message) => {
  const { id, operation, args = [] } = message || {};
  if (!id || !OPERATIONS.has(operation) || !Array.isArray(args)) {
    sendAndExit({
      id,
      ok: false,
      error: serializeError(Object.assign(new Error("Invalid Actual worker request"), { status: 400 })),
    }, 1);
    return;
  }

  try {
    const result = await actualCore[operation](...args);
    sendAndExit({ id, ok: true, result });
  } catch (error) {
    sendAndExit({ id, ok: false, error: serializeError(error) }, 1);
  }
});
