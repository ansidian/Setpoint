import * as actualCore from "./actual-core.ts";
import {
  isActualWorkerOperation,
  parseActualWorkerRequest,
} from "./actual-worker-protocol.ts";
import type {
  ActualWorkerErrorPayload,
  ActualWorkerResponse,
} from "./actual-worker-protocol.ts";

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
  "importTransactionGroups",
].filter(isActualWorkerOperation));

function serializeError(error: unknown): ActualWorkerErrorPayload {
  const candidate = typeof error === "object" && error !== null ? error as Record<string, unknown> : {};
  return {
    name: typeof candidate.name === "string" ? candidate.name : "Error",
    message: typeof candidate.message === "string" ? candidate.message : String(error),
    status: typeof candidate.status === "number" ? candidate.status : null,
    code: typeof candidate.code === "string" ? candidate.code : null,
    stack: process.env.NODE_ENV === "production" ? null : typeof candidate.stack === "string" ? candidate.stack : null,
  };
}

function sendPayload(payload: ActualWorkerResponse): void {
  if (typeof process.send !== "function") {
    return;
  }
  process.send(payload);
}

let operationQueue: Promise<void> = Promise.resolve();

process.on("message", (message: unknown) => {
  const request = parseActualWorkerRequest(message);
  if (!request || !OPERATIONS.has(request.operation)) {
    const id = typeof message === "object" && message !== null && typeof (message as { id?: unknown }).id === "string"
      ? (message as { id: string }).id
      : undefined;
    sendPayload({
      id,
      ok: false,
      error: serializeError(Object.assign(new Error("Invalid Actual worker request"), { status: 400 })),
    });
    return;
  }

  const { id, operation, args } = request;
  operationQueue = operationQueue
    .then(async () => {
      try {
        const handler: unknown = Reflect.get(actualCore, operation);
        if (typeof handler !== "function") throw Object.assign(new Error("Invalid Actual worker request"), { status: 400 });
        const result: unknown = await Reflect.apply(handler, actualCore, args);
        sendPayload({ id, ok: true, result });
      } catch (error) {
        sendPayload({ id, ok: false, error: serializeError(error) });
      }
    })
    .catch((error) => {
      sendPayload({ id, ok: false, error: serializeError(error) });
    });
});
