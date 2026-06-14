import "dotenv/config";

process.on("unhandledRejection", (err) => {
  console.error("[Unhandled Rejection]", err?.message || err);
});

import express from "express";
import cookieParser from "cookie-parser";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import authRoutes from "./routes/auth.js";
import briefingRoutes from "./routes/briefing/index.js";
import accountsRoutes from "./routes/accounts.js";
import dashboardRoutes from "./routes/dashboard.js";
import calendarRoutes from "./routes/calendar.js";
import alfredRoutes from "./routes/alfred.js";
import { startAlfredConversationSweeper } from "./alfred/alfred-conversations.js";
import notesRoutes from "./routes/notes.js";
import gmailPushRoutes from "./routes/gmail-push.js";
import todoistWebhookRoutes from "./routes/todoist-webhook.js";
import { initScheduler, startBackgroundIndexer, startReminderSchedulerWorker } from "./scheduler.js";
import { startSnoozeWaker } from "./snapshots/snooze-waker.js";
import { startEmailBackfillWorker } from "./email/email-backfill-worker.js";
import { startTodoistMirrorSyncWorker } from "./tasks/todoist-webhook.js";
import { startBillsMirrorRefreshWorker } from "./bills/bills-service.js";
import { startCalendarSearchMirrorSyncWorker } from "./calendar/calendar-search-mirror.js";
import { migrate } from "./db/migrate.js";
import { migrateCbcEncryption } from "./db/migrate-encryption.js";
import { applySecurityMiddleware, getTrustProxySetting } from "./security.js";
import { getMissingRequiredEnv } from "./env.js";
import { resolveWebAuthnConfig } from "./auth/webauthn-config.js";
import { buildStartupWorkerDelays } from "./startup-delays.js";
import { logTiming, timeAsync } from "./timing.js";
import { installProductionFrontend } from "./static-assets.js";
import { responseCompression } from "./middleware/compression.js";
import { errorHandler } from "./middleware/async-handler.js";


// fail fast if critical env vars are missing
const missing = getMissingRequiredEnv();
if (missing.length) {
  console.error(`[EA] Missing required env vars: ${missing.join(", ")}`);
  process.exit(1);
}
try {
  resolveWebAuthnConfig();
} catch (err) {
  console.error(err.message);
  process.exit(1);
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT =
  process.env.NODE_ENV === "production"
    ? process.env.PORT || 3001
    : process.env.EA_SERVER_PORT || 3001;
const bootStartedAt = performance.now();

app.set("trust proxy", getTrustProxySetting());

applySecurityMiddleware(app);
// P1-2: gzip every compressible response (JSON APIs + static frontend) before the
// routers run. zlib-based, no dependency; skips SSE/binary/pre-encoded responses
// so the Alfred + dashboard event streams are never buffered. Sits ahead of the
// routes and installProductionFrontend so both API and asset payloads shrink.
app.use(responseCompression());
app.use("/api/todoist/webhook", express.raw({ type: "*/*" }), todoistWebhookRoutes);
app.use(express.json());
app.use(cookieParser());

// CSRF protection: require custom header on all state-changing API requests.
// Bearer-authenticated requests are exempt — CSRF only applies to cookie auth,
// and a forged request can't attach a bearer token the attacker doesn't have.
app.use("/api", (req, res, next) => {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") {
    return next();
  }
  if (req.path === "/gmail/push") return next();
  if (req.path === "/auth/login") return next();
  if (req.headers.authorization?.startsWith("Bearer ")) return next();
  if (req.headers["x-requested-with"] !== "Setpoint") {
    return res.status(403).json({ message: "Forbidden" });
  }
  next();
});

// API routes
app.use("/api/auth", authRoutes);
app.use("/api/briefing", briefingRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/ea", accountsRoutes);
app.use("/api/calendar", calendarRoutes);
app.use("/api/alfred", alfredRoutes);
app.use("/api/notes", notesRoutes);
app.use("/api/gmail", gmailPushRoutes);

// Serve static frontend in production (behind auth)
if (process.env.NODE_ENV === "production") {
  installProductionFrontend(app, join(__dirname, "../dist"));
}

// Terminal error middleware (P1-12). MUST stay last, after every route mount and
// the static block above. Async route rejections are forwarded here by each
// router's wrapRouterAsync (see server/middleware/async-handler.js); without
// this, even forwarded errors would fall through to Express's default HTML
// handler.
app.use(errorHandler);

function scheduleStartupWorker(worker, delayMs, fn) {
  logTiming({
    event: "startup-worker-scheduled",
    worker,
    delayMs,
  });
  const start = () => {
    timeAsync(`startup:${worker}`, async () => fn(), { worker }).catch((err) =>
      console.error(`[EA ${worker}] Startup failed:`, err.message),
    );
  };
  if (delayMs <= 0) {
    start();
    return;
  }
  const timer = setTimeout(start, delayMs);
  timer.unref?.();
}

timeAsync("migrations", () => migrate())
  .then(() => timeAsync("encryption-rewrite", () => migrateCbcEncryption()))
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Setpoint running on http://localhost:${PORT}`);
      logTiming({
        event: "boot",
        phase: "listen",
        ms: performance.now() - bootStartedAt,
        status: "ok",
        port: PORT,
      });
      const startupDelays = buildStartupWorkerDelays();
      scheduleStartupWorker("scheduler", startupDelays.scheduler, () => initScheduler());
      scheduleStartupWorker("indexer", startupDelays.indexer, () => startBackgroundIndexer());
      scheduleStartupWorker("backfill", startupDelays.backfill, () => startEmailBackfillWorker());
      scheduleStartupWorker("snooze", startupDelays.snooze, () => startSnoozeWaker());
      scheduleStartupWorker("todoist-sync", startupDelays.todoistSync, () => startTodoistMirrorSyncWorker());
      scheduleStartupWorker("bills-mirror", startupDelays.billsMirror, () => startBillsMirrorRefreshWorker());
      scheduleStartupWorker("calendar-search-mirror", startupDelays.calendarSearchMirror, () => startCalendarSearchMirrorSyncWorker());
      scheduleStartupWorker("reminders", startupDelays.reminders, () => startReminderSchedulerWorker());
      startAlfredConversationSweeper();
    });
  }).catch((err) => {
    console.error("Migration failed:", err);
    process.exit(1);
  });
