import { fork } from "child_process";
import path from "path";

const DEFAULT_TIMEOUT_MS = 120_000;
const OUTPUT_LIMIT = 8_000;
const WORKER_PATH = path.resolve("server/briefing/actual-worker-child.js");

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
  if (!Number.isFinite(maxOldSpace) || maxOldSpace <= 0) return [];
  return [`--max-old-space-size=${Math.floor(maxOldSpace)}`];
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

export function runActualWorkerOperation(operation, args = [], options = {}) {
  const requestId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  const child = fork(options.workerPath || WORKER_PATH, [], {
    env: process.env,
    execArgv: options.execArgv || workerExecArgv(),
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  let settled = false;
  let stderr = "";

  child.stderr?.on("data", (chunk) => {
    stderr = appendBounded(stderr, String(chunk));
  });
  child.stdout?.on("data", () => {});

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (settled) return;
      child.kill("SIGTERM");
      rejectOnce(workerExitError({ operation, code: null, signal: "SIGTERM", stderr, timedOut: true }));
    }, options.timeoutMs || timeoutMs());
    const rejectOnce = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    };
    const resolveOnce = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };

    child.on("message", (message) => {
      if (message?.id !== requestId) return;
      if (message.ok) resolveOnce(message.result);
      else rejectOnce(deserializeError(message.error));
    });
    child.on("error", rejectOnce);
    child.on("exit", (code, signal) => {
      if (settled) return;
      rejectOnce(workerExitError({ operation, code, signal, stderr, timedOut: false }));
    });

    child.send({ id: requestId, operation, args });
  });
}
