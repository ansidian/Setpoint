import { Router } from "express";
import { requireCookieSession } from "../middleware/auth.ts";
import {
  formatCurrentDashboardSse,
  subscribeCurrentDashboardEvents,
} from "../dashboard/current-events.ts";
import {
  getCurrentDashboard,
  getDashboardFinance,
  getDashboardSystemHealth,
  requestCurrentDashboardRefresh,
  syncCurrentDashboard,
} from "../dashboard/current-service.ts";
import { timeRoute } from "../timing.ts";
import { transactionImportStore } from "../transaction-imports/transaction-import-store.ts";

const router = Router();

router.use(requireCookieSession);

router.get("/finance/review-runs", timeRoute("/api/dashboard/finance/review-runs"), async (req, res) => {
  const rawOffset = req.query.offset;
  if (rawOffset !== undefined && (typeof rawOffset !== "string" || !/^\d+$/.test(rawOffset))) {
    res.status(400).json({ message: "Offset must be a non-negative integer" });
    return;
  }
  const offset = rawOffset === undefined ? 0 : Number(rawOffset);
  if (!Number.isSafeInteger(offset)) {
    res.status(400).json({ message: "Offset must be a non-negative integer" });
    return;
  }
  try {
    res.json(await transactionImportStore.listReviewRuns(process.env.EA_USER_ID!, 12, offset));
  } catch (err) {
    console.error("[Dashboard] finance review runs fetch failed:", err);
    res.status(500).json({ message: "Failed to fetch financial review runs" });
  }
});

router.get("/finance", timeRoute("/api/dashboard/finance"), async (_req, res) => {
  try {
    res.json(await getDashboardFinance(process.env.EA_USER_ID!));
  } catch (err) {
    console.error("[Dashboard] finance fetch failed:", err);
    res.status(500).json({ message: "Failed to fetch dashboard finance data" });
  }
});

router.get("/current/events", (_req, res) => {
  const userId = process.env.EA_USER_ID;
  res.status(200);
  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders?.();
  res.write("retry: 5000\n");
  res.write(`event: dashboard-current-connected\ndata: ${JSON.stringify({
    type: "dashboard_current_connected",
    occurredAt: new Date().toISOString(),
  })}\n\n`);

  const unsubscribe = subscribeCurrentDashboardEvents(userId, (event) => {
    res.write(formatCurrentDashboardSse(event));
  });
  const keepalive = setInterval(() => {
    res.write(": keepalive\n\n");
  }, 25_000);
  keepalive.unref?.();

  _req.on("close", () => {
    clearInterval(keepalive);
    unsubscribe();
  });
});

router.get("/current", timeRoute("/api/dashboard/current"), async (_req, res) => {
  try {
    res.json(await getCurrentDashboard(process.env.EA_USER_ID!));
  } catch (err) {
    console.error("[Dashboard] current fetch failed:", err);
    res.status(500).json({ message: "Failed to fetch current dashboard data" });
  }
});

router.get("/health", timeRoute("/api/dashboard/health"), async (_req, res) => {
  try {
    res.json(await getDashboardSystemHealth(process.env.EA_USER_ID!));
  } catch (err) {
    console.error("[Dashboard] health fetch failed:", err);
    res.status(500).json({ message: "Failed to fetch dashboard health" });
  }
});

router.post("/current/refresh", timeRoute("/api/dashboard/current/refresh"), async (_req, res) => {
  try {
    res.json(await requestCurrentDashboardRefresh(process.env.EA_USER_ID!));
  } catch (err) {
    console.error("[Dashboard] current refresh request failed:", err);
    res.status(500).json({ message: "Failed to request current dashboard refresh" });
  }
});

router.post("/current/sync", timeRoute("/api/dashboard/current/sync"), async (_req, res) => {
  try {
    res.json(await syncCurrentDashboard(process.env.EA_USER_ID!));
  } catch (err) {
    console.error("[Dashboard] current sync failed:", err);
    res.status(500).json({ message: "Failed to sync current dashboard data" });
  }
});

export default router;
