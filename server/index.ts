import "dotenv/config";

process.on("unhandledRejection", (err: unknown) => {
  console.error("[Unhandled Rejection]", err instanceof Error ? err.message : err);
});

import express from "express";
import cookieParser from "cookie-parser";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import authRoutes from "./routes/auth.ts";
import briefingRoutes from "./routes/briefing/index.ts";
import accountsRoutes from "./routes/accounts.ts";
import dashboardRoutes from "./routes/dashboard.ts";
import calendarRoutes from "./routes/calendar.ts";
import alfredRoutes from "./routes/alfred.ts";
import { startAlfredConversationSweeper, stopAlfredConversationSweeper } from "./alfred/alfred-conversations.ts";
import notesRoutes from "./routes/notes.ts";
import newsRoutes from "./routes/news.ts";
import gmailPushRoutes from "./routes/gmail-push.ts";
import todoistWebhookRoutes from "./routes/todoist-webhook.ts";
import instanceCredentialRoutes from "./routes/instance-credentials.ts";
import capabilityRoutes from "./routes/capabilities.ts";
import onboardingRoutes from "./routes/onboarding.ts";
import todoistOAuthRoutes from "./routes/todoist-oauth.ts";
import { initScheduler, startBackgroundIndexer, startReminderSchedulerWorker, stopScheduler } from "./scheduler.ts";
import { startSnoozeWaker, stopSnoozeWaker } from "./snapshots/snooze-waker.ts";
import { startEmailBackfillWorker, stopEmailBackfillWorker } from "./email/email-backfill-worker.ts";
import { startTodoistMirrorSyncWorker, stopTodoistMirrorSyncWorker } from "./tasks/todoist-webhook.ts";
import { startBillsMirrorRefreshWorker, stopBillsMirrorRefreshWorker } from "./bills/bills-service.ts";
import { startCalendarSearchMirrorSyncWorker, stopCalendarSearchMirrorSyncWorker } from "./calendar/calendar-search-mirror.ts";
import { startNewsPollWorker, stopNewsPollWorker } from "./news/news-poller.ts";
import { createGracefulShutdown } from "./shutdown.ts";
import { migrate } from "./db/migrate.ts";
import { migrateCbcEncryption } from "./db/migrate-encryption.ts";
import { applySecurityMiddleware, getTrustProxySetting } from "./security.ts";
import { getMissingRequiredEnv } from "./env.ts";
import { buildStartupWorkerDelays } from "./startup-delays.ts";
import { logTiming, timeAsync } from "./timing.ts";
import { installProductionFrontend } from "./static-assets.ts";
import { responseCompression } from "./middleware/compression.ts";
import { errorHandler } from "./middleware/async-handler.ts";
import { requireClaimedInstance } from "./middleware/owner-gate.ts";
import { resolveOwnerBootstrap } from "./auth/owner-bootstrap.ts";
import { ownerStore } from "./auth/owner-store.ts";
import { activateOwner, getActiveOwner, onOwnerActivated } from "./auth/owner-context.ts";
import { createOwnerRuntimeGate } from "./auth/owner-runtime.ts";
import { canonicalUrlService } from "./platform/canonical-url.ts";
import { assertValidRootEncryptionKey } from "./platform/encryption.ts";
import { rootKeyHealthService } from "./platform/root-key-health.ts";


// fail fast if critical env vars are missing
const missing = getMissingRequiredEnv();
if (missing.length) {
  console.error(`[EA] Missing required env vars: ${missing.join(", ")}`);
  process.exit(1);
}
try {
  assertValidRootEncryptionKey();
} catch (error) {
  console.error(`[EA] ${error instanceof Error ? error.message : "EA_ENCRYPTION_KEY is invalid"}`);
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
app.get("/healthz", (_req, res) => {
  res.json({ status: "ok" });
});
app.use("/api", requireClaimedInstance);
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
app.use("/api/ea", todoistOAuthRoutes);
app.use("/api/ea", accountsRoutes);
app.use("/api/calendar", calendarRoutes);
app.use("/api/alfred", alfredRoutes);
app.use("/api/notes", notesRoutes);
app.use("/api/news", newsRoutes);
app.use("/api/gmail", gmailPushRoutes);
app.use("/api/instance-credentials", instanceCredentialRoutes);
app.use("/api/capabilities", capabilityRoutes);
app.use("/api/onboarding", onboardingRoutes);

// Serve static frontend in production (behind auth)
if (process.env.NODE_ENV === "production") {
  installProductionFrontend(app, join(__dirname, "../dist"));
}

// Terminal error middleware (P1-12). MUST stay last, after every route mount and
// the static block above. Async route rejections are forwarded here by each
// router's wrapRouterAsync (see server/middleware/async-handler.ts); without
// this, even forwarded errors would fall through to Express's default HTML
// handler.
app.use(errorHandler);

function scheduleStartupWorker(
  worker: string,
  delayMs: number,
  fn: () => unknown | PromiseLike<unknown>,
): void {
  logTiming({
    event: "startup-worker-scheduled",
    worker,
    delayMs,
  });
  const start = () => {
    timeAsync(`startup:${worker}`, async () => fn(), { worker }).catch((err: unknown) =>
      console.error(`[EA ${worker}] Startup failed:`, err instanceof Error ? err.message : err),
    );
  };
  if (delayMs <= 0) {
    start();
    return;
  }
  const timer = setTimeout(start, delayMs);
  timer.unref?.();
}

function startOwnerRuntime(): void {
  const startupDelays = buildStartupWorkerDelays();
  scheduleStartupWorker("scheduler", startupDelays.scheduler, () => initScheduler());
  scheduleStartupWorker("indexer", startupDelays.indexer, () => startBackgroundIndexer());
  scheduleStartupWorker("backfill", startupDelays.backfill, () => startEmailBackfillWorker());
  scheduleStartupWorker("snooze", startupDelays.snooze, () => startSnoozeWaker());
  scheduleStartupWorker("todoist-sync", startupDelays.todoistSync, () => startTodoistMirrorSyncWorker());
  scheduleStartupWorker("bills-mirror", startupDelays.billsMirror, () => startBillsMirrorRefreshWorker());
  scheduleStartupWorker("calendar-search-mirror", startupDelays.calendarSearchMirror, () => startCalendarSearchMirrorSyncWorker());
  scheduleStartupWorker("reminders", startupDelays.reminders, () => startReminderSchedulerWorker());
  scheduleStartupWorker("news-poll", startupDelays.news, () => startNewsPollWorker());
  startAlfredConversationSweeper();
}

const ownerRuntimeGate = createOwnerRuntimeGate(() => startOwnerRuntime());

timeAsync("migrations", () => migrate())
  .then(() => timeAsync("encryption-rewrite", () => migrateCbcEncryption()))
  .then(() => timeAsync("root-key-health", () => rootKeyHealthService.assertDecryptable()))
  .then(() => timeAsync("owner-bootstrap", () => resolveOwnerBootstrap({
    store: ownerStore,
    env: process.env,
  })))
  .then(async (bootstrap) => {
    if (bootstrap.claimed) {
      await timeAsync("canonical-url-bootstrap", () => canonicalUrlService.resolveCanonicalOrigin(process.env));
    }
    return bootstrap;
  })
  .then((bootstrap) => {
    if (bootstrap.claimed) activateOwner(bootstrap.owner);
    const server = app.listen(PORT, () => {
      console.log(`Setpoint running on http://localhost:${PORT}`);
      logTiming({
        event: "boot",
        phase: "listen",
        ms: performance.now() - bootStartedAt,
        status: "ok",
        port: PORT,
      });
      ownerRuntimeGate.startForOwner(getActiveOwner());
    });

    onOwnerActivated((owner) => {
      ownerRuntimeGate.startForOwner(owner);
    });

    const { shutdown } = createGracefulShutdown({
      server,
      stopFns: [
        stopScheduler,                        // cron jobs + reminder worker (scheduler.ts)
        stopEmailBackfillWorker,              // Task 1
        stopSnoozeWaker,                      // Task 1
        stopTodoistMirrorSyncWorker,          // tasks/todoist-webhook.ts:248
        stopBillsMirrorRefreshWorker,         // Task 1
        stopCalendarSearchMirrorSyncWorker,   // calendar/calendar-search-mirror:159
        stopNewsPollWorker,                   // news/news-poller.js:249
        stopAlfredConversationSweeper,        // Task 1
      ],
    });
    for (const signal of ["SIGTERM", "SIGINT"]) process.on(signal, () => shutdown(signal));
  }).catch((err) => {
    console.error("Startup failed:", err);
    process.exit(1);
  });
