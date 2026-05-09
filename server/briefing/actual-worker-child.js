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

function sendPayload(payload) {
  if (typeof process.send !== "function") {
    return;
  }
  process.send(payload);
}

let operationQueue = Promise.resolve();

process.on("message", async (message) => {
  const { id, operation, args = [] } = message || {};
  if (!id || !OPERATIONS.has(operation) || !Array.isArray(args)) {
    sendPayload({
      id,
      ok: false,
      error: serializeError(Object.assign(new Error("Invalid Actual worker request"), { status: 400 })),
    });
    return;
  }

  operationQueue = operationQueue
    .then(async () => {
      try {
        const result = await actualCore[operation](...args);
        sendPayload({ id, ok: true, result });
      } catch (error) {
        sendPayload({ id, ok: false, error: serializeError(error) });
      }
    })
    .catch((error) => {
      sendPayload({ id, ok: false, error: serializeError(error) });
    });
});
