export type ActualWorkerOperation =
  | "testConnection"
  | "getMetadata"
  | "getAccounts"
  | "getRecentTransactions"
  | "getPayees"
  | "getCategories"
  | "getUpcomingBills"
  | "getCalendarBillsRange"
  | "markBillPaid"
  | "sendBill"
  | "createQuickTxn"
  | "importTransactionGroups";

export interface ActualWorkerRequest {
  id: string;
  operation: ActualWorkerOperation;
  args: unknown[];
}

export interface ActualWorkerErrorPayload {
  name: string;
  message: string;
  status: number | null;
  code: string | null;
  stack: string | null;
}

export type ActualWorkerResponse =
  | { id: string; ok: true; result: unknown }
  | { id: string | undefined; ok: false; error: ActualWorkerErrorPayload };

export type ActualWorkerHealthState = "idle" | "running" | "unavailable";

export interface ActualWorkerHealth {
  state: ActualWorkerHealthState;
  pid: number | null;
  inFlight: number;
  startedAt: string | null;
  lastExitAt: string | null;
  lastExit: { code: number | null; signal: NodeJS.Signals | null } | null;
  lastError: string | null;
}

export interface ActualWorkerOptions {
  workerPath?: string;
  execArgv?: string[];
  timeoutMs?: number;
  shutdownAfterOperation?: boolean;
  forceKillGraceMs?: number;
}

const OPERATIONS: ReadonlySet<string> = new Set<ActualWorkerOperation>([
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
]);

export function isActualWorkerOperation(value: unknown): value is ActualWorkerOperation {
  return typeof value === "string" && OPERATIONS.has(value);
}

export function parseActualWorkerRequest(value: unknown): ActualWorkerRequest | null {
  if (typeof value !== "object" || value === null) return null;
  const request = value as Record<string, unknown>;
  if (typeof request.id !== "string" || !isActualWorkerOperation(request.operation) || !Array.isArray(request.args)) {
    return null;
  }
  return { id: request.id, operation: request.operation, args: request.args };
}

export function parseActualWorkerResponse(value: unknown): ActualWorkerResponse | null {
  if (typeof value !== "object" || value === null) return null;
  const response = value as Record<string, unknown>;
  if (typeof response.id !== "string" || typeof response.ok !== "boolean") return null;
  if (response.ok) return { id: response.id, ok: true, result: response.result };
  const error = response.error;
  if (typeof error !== "object" || error === null) return null;
  const payload = error as Record<string, unknown>;
  return {
    id: response.id,
    ok: false,
    error: {
      name: typeof payload.name === "string" ? payload.name : "Error",
      message: typeof payload.message === "string" ? payload.message : "Actual worker failed",
      status: typeof payload.status === "number" ? payload.status : null,
      code: typeof payload.code === "string" ? payload.code : null,
      stack: typeof payload.stack === "string" ? payload.stack : null,
    },
  };
}
