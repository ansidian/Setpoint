import { fork } from "child_process";
import type { ChildProcess } from "child_process";
import path from "path";
import {
  parseActualWorkerResponse,
} from "./actual-worker-protocol.ts";
import type {
  ActualWorkerErrorPayload,
  ActualWorkerHealth,
  ActualWorkerOperation,
  ActualWorkerOptions,
} from "./actual-worker-protocol.ts";

type WorkerError = Error & { status?: number; code?: string };
interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
  timer: NodeJS.Timeout;
  operation: ActualWorkerOperation;
  shutdownAfterOperation: boolean;
  forceKillGraceMs?: number;
}

const DEFAULT_TIMEOUT_MS = 120_000;
const PRODUCTION_DEFAULT_MAX_OLD_SPACE_MB = 192;
const FORCE_KILL_GRACE_MS = 2_000;
const OUTPUT_LIMIT = 8_000;
const WORKER_PATH = path.resolve("server/actual/actual-worker-child.ts");
const INITIAL_HEALTH: ActualWorkerHealth = {
  state: "idle",
  pid: null,
  inFlight: 0,
  startedAt: null,
  lastExitAt: null,
  lastExit: null,
  lastError: null,
};

let worker: ChildProcess | null = null;
let workerStderr = "";
let pendingRequests = new Map<string, PendingRequest>();
let operationQueue: Promise<unknown> = Promise.resolve();
let health: ActualWorkerHealth = { ...INITIAL_HEALTH };
let idleShutdownTimer: NodeJS.Timeout | null = null;
const expectedWorkerExits = new Set<ChildProcess>();
const workerForceKillTimers = new Map<ChildProcess, NodeJS.Timeout>();

function appendBounded(current: string, chunk: string): string {
  const next = current + chunk;
  return next.length > OUTPUT_LIMIT ? next.slice(next.length - OUTPUT_LIMIT) : next;
}

function timeoutMs(): number {
  const value = Number(process.env.EA_ACTUAL_WORKER_TIMEOUT_MS);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_TIMEOUT_MS;
}

function workerExecArgv(): string[] {
  const maxOldSpace = Number(process.env.EA_ACTUAL_WORKER_MAX_OLD_SPACE_MB);
  if (Number.isFinite(maxOldSpace) && maxOldSpace > 0) {
    return [`--max-old-space-size=${Math.floor(maxOldSpace)}`];
  }
  if (process.env.NODE_ENV === "production") {
    return [`--max-old-space-size=${PRODUCTION_DEFAULT_MAX_OLD_SPACE_MB}`];
  }
  return [];
}

function idleShutdownMs(): number {
  const configured = Number(process.env.EA_ACTUAL_WORKER_IDLE_SHUTDOWN_MS);
  if (Number.isFinite(configured) && configured >= 0) return configured;
  return process.env.NODE_ENV === "production" ? 60_000 : 0;
}

function clearIdleShutdownTimer(): void {
  if (!idleShutdownTimer) return;
  clearTimeout(idleShutdownTimer);
  idleShutdownTimer = null;
}

function clearForceKillTimer(child: ChildProcess): void {
  const timer = workerForceKillTimers.get(child);
  if (!timer) return;
  clearTimeout(timer);
  workerForceKillTimers.delete(child);
}

function armForceKill(child: ChildProcess, delayMs: number = FORCE_KILL_GRACE_MS): void {
  clearForceKillTimer(child);
  if (!Number.isFinite(delayMs) || delayMs < 0) return;
  const timer = setTimeout(() => {
    workerForceKillTimers.delete(child);
    child.kill("SIGKILL");
  }, delayMs);
  timer.unref?.();
  workerForceKillTimers.set(child, timer);
}

function requestWorkerShutdown(child: ChildProcess | null, {
  expected = false,
  discard = false,
  forceKillGraceMs = FORCE_KILL_GRACE_MS,
}: { expected?: boolean; discard?: boolean; forceKillGraceMs?: number } = {}): void {
  if (!child) return;
  clearIdleShutdownTimer();
  if (expected) expectedWorkerExits.add(child);
  if (discard && worker === child) {
    worker = null;
    if (expected && !pendingRequests.size) {
      health = {
        ...health,
        state: "idle",
        pid: null,
        inFlight: 0,
        lastError: null,
      };
    }
  }
  child.kill("SIGTERM");
  armForceKill(child, forceKillGraceMs);
}

function scheduleIdleShutdown(): void {
  clearIdleShutdownTimer();
  const delay = idleShutdownMs();
  if (!worker || pendingRequests.size || delay <= 0) return;
  idleShutdownTimer = setTimeout(() => {
    if (!worker || pendingRequests.size) return;
    requestWorkerShutdown(worker, { expected: true, discard: true });
  }, delay);
  idleShutdownTimer.unref?.();
}

function deserializeError(errorPayload: Partial<ActualWorkerErrorPayload> = {}): WorkerError {
  const error: WorkerError = new Error(errorPayload.message || "Actual worker failed");
  error.name = errorPayload.name || "Error";
  if (errorPayload.status) error.status = errorPayload.status;
  if (errorPayload.code) error.code = errorPayload.code;
  if (errorPayload.stack) error.stack = errorPayload.stack;
  return error;
}

function workerExitError({ operation, code, signal, stderr, timedOut }: { operation: string; code: number | null; signal: NodeJS.Signals | null; stderr: string; timedOut: boolean }): WorkerError {
  const statusText = signal ? `signal ${signal}` : `status ${code}`;
  const message = timedOut
    ? `Actual worker timed out while running ${operation}`
    : `Actual worker exited with ${statusText} while running ${operation}`;
  const error: WorkerError = new Error(stderr.trim() ? `${message}: ${stderr.trim()}` : message);
  error.status = timedOut ? 504 : 502;
  error.code = timedOut ? "ACTUAL_WORKER_TIMEOUT" : "ACTUAL_WORKER_EXITED";
  return error;
}

function makeRequestId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function rejectPendingRequests(error: unknown): void {
  for (const request of pendingRequests.values()) {
    clearTimeout(request.timer);
    request.reject(error);
  }
  pendingRequests.clear();
}

function spawnWorker(options: ActualWorkerOptions = {}): ChildProcess {
  clearIdleShutdownTimer();
  if (worker) return worker;
  const child = fork(options.workerPath || WORKER_PATH, [], {
    env: process.env,
    execArgv: options.execArgv || workerExecArgv(),
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  worker = child;
  const startedAt = new Date().toISOString();
  workerStderr = "";
  health = {
    ...health,
    state: "idle",
    pid: child.pid || null,
    startedAt,
    lastError: null,
  };
  child.stderr?.on("data", (chunk) => {
    workerStderr = appendBounded(workerStderr, String(chunk));
  });
  child.stdout?.on("data", () => {});
  child.on("message", (rawMessage: unknown) => {
    const message = parseActualWorkerResponse(rawMessage);
    if (!message || !message.id) return;
    const request = pendingRequests.get(message.id);
    if (!request) return;
    pendingRequests.delete(message.id);
    clearTimeout(request.timer);
    health = {
      ...health,
      state: pendingRequests.size ? "running" : "idle",
      inFlight: pendingRequests.size,
      lastError: message.ok ? null : message.error?.message || "Actual worker failed",
    };
    if (message.ok) request.resolve(message.result);
    else request.reject(deserializeError(message.error));
    if (!pendingRequests.size) {
      if (request.shutdownAfterOperation) {
        requestWorkerShutdown(child, {
          expected: true,
          discard: true,
          forceKillGraceMs: request.forceKillGraceMs,
        });
      } else {
        scheduleIdleShutdown();
      }
    }
  });
  child.on("error", (error) => {
    clearForceKillTimer(child);
    expectedWorkerExits.delete(child);
    if (worker !== child) return;
    health = {
      ...health,
      state: "unavailable",
      inFlight: 0,
      lastError: error.message,
    };
    rejectPendingRequests(error);
    worker = null;
  });
  child.on("exit", (code, signal) => {
    const exitedWorker = worker === child;
    if (exitedWorker) worker = null;
    if (exitedWorker) clearIdleShutdownTimer();
    clearForceKillTimer(child);
    const expectedShutdown = expectedWorkerExits.has(child);
    expectedWorkerExits.delete(child);
    if (!exitedWorker) return;
    const lastExitAt = new Date().toISOString();
    const error = workerExitError({
      operation: pendingRequests.size ? "pending operation" : "idle",
      code,
      signal,
      stderr: workerStderr,
      timedOut: false,
    });
    health = {
      ...health,
      state: expectedShutdown ? "idle" : "unavailable",
      pid: null,
      inFlight: 0,
      lastExitAt,
      lastExit: { code, signal },
      lastError: expectedShutdown ? null : error.message,
    };
    if (!expectedShutdown) rejectPendingRequests(error);
  });
  return child;
}

function sendOperation<T>(operation: ActualWorkerOperation, args: unknown[], options: ActualWorkerOptions = {}): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const child = spawnWorker(options);
    const requestId = makeRequestId();
    const timer = setTimeout(() => {
      const request = pendingRequests.get(requestId);
      if (!request) return;
      pendingRequests.delete(requestId);
      const error = workerExitError({
        operation,
        code: null,
        signal: "SIGTERM",
        stderr: workerStderr,
        timedOut: true,
      });
      health = {
        ...health,
        state: "unavailable",
        pid: null,
        inFlight: pendingRequests.size,
        lastError: error.message,
      };
      requestWorkerShutdown(child, {
        discard: true,
        forceKillGraceMs: options.forceKillGraceMs,
      });
      reject(error);
    }, options.timeoutMs || timeoutMs());
    pendingRequests.set(requestId, {
      resolve: (value) => resolve(value as T),
      reject,
      timer,
      operation,
      shutdownAfterOperation: options.shutdownAfterOperation === true,
      forceKillGraceMs: options.forceKillGraceMs,
    });
    health = {
      ...health,
      state: "running",
      pid: child.pid || null,
      inFlight: pendingRequests.size,
    };
    child.send({ id: requestId, operation, args });
  });
}

export function runActualWorkerOperation<T = unknown>(operation: ActualWorkerOperation, args: unknown[] = [], options: ActualWorkerOptions = {}): Promise<T> {
  const run = () => sendOperation<T>(operation, args, options);
  const result = operationQueue.then(run, run) as Promise<T>;
  operationQueue = result.catch(() => {});
  return result;
}

export function getActualWorkerHealth(): ActualWorkerHealth {
  return { ...health };
}

export function shutdownActualWorker(): void {
  clearIdleShutdownTimer();
  if (worker) {
    worker.kill("SIGTERM");
    worker = null;
  }
  for (const timer of workerForceKillTimers.values()) clearTimeout(timer);
  workerForceKillTimers.clear();
  expectedWorkerExits.clear();
  rejectPendingRequests(Object.assign(new Error("Actual worker shut down"), { status: 503 }));
  pendingRequests = new Map<string, PendingRequest>();
  operationQueue = Promise.resolve();
  workerStderr = "";
  health = { ...INITIAL_HEALTH };
}
