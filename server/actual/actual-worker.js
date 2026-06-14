import { fork } from "child_process";
import path from "path";

const DEFAULT_TIMEOUT_MS = 120_000;
const PRODUCTION_DEFAULT_MAX_OLD_SPACE_MB = 192;
const FORCE_KILL_GRACE_MS = 2_000;
const OUTPUT_LIMIT = 8_000;
const WORKER_PATH = path.resolve("server/actual/actual-worker-child.js");
const INITIAL_HEALTH = {
  state: "idle",
  pid: null,
  inFlight: 0,
  startedAt: null,
  lastExitAt: null,
  lastExit: null,
  lastError: null,
};

let worker = null;
let workerStderr = "";
let pendingRequests = new Map();
let operationQueue = Promise.resolve();
let health = { ...INITIAL_HEALTH };
let idleShutdownTimer = null;
const expectedWorkerExits = new Set();
const workerForceKillTimers = new Map();

function appendBounded(current, chunk) {
  const next = current + chunk;
  return next.length > OUTPUT_LIMIT ? next.slice(next.length - OUTPUT_LIMIT) : next;
}

function timeoutMs() {
  const value = Number(process.env.EA_ACTUAL_WORKER_TIMEOUT_MS);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_TIMEOUT_MS;
}

function workerExecArgv() {
  const maxOldSpace = Number(process.env.EA_ACTUAL_WORKER_MAX_OLD_SPACE_MB);
  if (Number.isFinite(maxOldSpace) && maxOldSpace > 0) {
    return [`--max-old-space-size=${Math.floor(maxOldSpace)}`];
  }
  if (process.env.NODE_ENV === "production") {
    return [`--max-old-space-size=${PRODUCTION_DEFAULT_MAX_OLD_SPACE_MB}`];
  }
  return [];
}

function idleShutdownMs() {
  const configured = Number(process.env.EA_ACTUAL_WORKER_IDLE_SHUTDOWN_MS);
  if (Number.isFinite(configured) && configured >= 0) return configured;
  return process.env.NODE_ENV === "production" ? 60_000 : 0;
}

function clearIdleShutdownTimer() {
  if (!idleShutdownTimer) return;
  clearTimeout(idleShutdownTimer);
  idleShutdownTimer = null;
}

function clearForceKillTimer(child) {
  const timer = workerForceKillTimers.get(child);
  if (!timer) return;
  clearTimeout(timer);
  workerForceKillTimers.delete(child);
}

function armForceKill(child, delayMs = FORCE_KILL_GRACE_MS) {
  clearForceKillTimer(child);
  if (!Number.isFinite(delayMs) || delayMs < 0) return;
  const timer = setTimeout(() => {
    workerForceKillTimers.delete(child);
    child.kill("SIGKILL");
  }, delayMs);
  timer.unref?.();
  workerForceKillTimers.set(child, timer);
}

function requestWorkerShutdown(child, {
  expected = false,
  discard = false,
  forceKillGraceMs = FORCE_KILL_GRACE_MS,
} = {}) {
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

function scheduleIdleShutdown() {
  clearIdleShutdownTimer();
  const delay = idleShutdownMs();
  if (!worker || pendingRequests.size || delay <= 0) return;
  idleShutdownTimer = setTimeout(() => {
    if (!worker || pendingRequests.size) return;
    requestWorkerShutdown(worker, { expected: true, discard: true });
  }, delay);
  idleShutdownTimer.unref?.();
}

function deserializeError(errorPayload = {}) {
  const error = new Error(errorPayload.message || "Actual worker failed");
  error.name = errorPayload.name || "Error";
  if (errorPayload.status) error.status = errorPayload.status;
  if (errorPayload.code) error.code = errorPayload.code;
  if (errorPayload.stack) error.stack = errorPayload.stack;
  return error;
}

function workerExitError({ operation, code, signal, stderr, timedOut }) {
  const statusText = signal ? `signal ${signal}` : `status ${code}`;
  const message = timedOut
    ? `Actual worker timed out while running ${operation}`
    : `Actual worker exited with ${statusText} while running ${operation}`;
  const error = new Error(stderr.trim() ? `${message}: ${stderr.trim()}` : message);
  error.status = timedOut ? 504 : 502;
  error.code = timedOut ? "ACTUAL_WORKER_TIMEOUT" : "ACTUAL_WORKER_EXITED";
  return error;
}

function makeRequestId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function rejectPendingRequests(error) {
  for (const request of pendingRequests.values()) {
    clearTimeout(request.timer);
    request.reject(error);
  }
  pendingRequests.clear();
}

function spawnWorker(options = {}) {
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
  child.on("message", (message) => {
    const request = pendingRequests.get(message?.id);
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

function sendOperation(operation, args, options = {}) {
  return new Promise((resolve, reject) => {
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
      resolve,
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

export function runActualWorkerOperation(operation, args = [], options = {}) {
  const run = () => sendOperation(operation, args, options);
  const result = operationQueue.then(run, run);
  operationQueue = result.catch(() => {});
  return result;
}

export function getActualWorkerHealth() {
  return { ...health };
}

export function shutdownActualWorkerForTests() {
  clearIdleShutdownTimer();
  if (worker) {
    worker.kill("SIGTERM");
    worker = null;
  }
  for (const timer of workerForceKillTimers.values()) clearTimeout(timer);
  workerForceKillTimers.clear();
  expectedWorkerExits.clear();
  rejectPendingRequests(Object.assign(new Error("Actual worker shut down"), { status: 503 }));
  pendingRequests = new Map();
  operationQueue = Promise.resolve();
  workerStderr = "";
  health = { ...INITIAL_HEALTH };
}

export const __testing__ = {
  workerExitError,
  appendBounded,
};
