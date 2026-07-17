import { Router } from "express";
import { requireCookieSession } from "../middleware/auth.ts";
import {
  formatCurrentDashboardSse,
  subscribeCurrentDashboardEvents,
} from "../dashboard/current-events.js";
import {
  getCurrentDashboard,
  getDashboardSystemHealth,
  requestCurrentDashboardRefresh,
  syncCurrentDashboard,
} from "../dashboard/current-service.js";
import { timeRoute } from "../timing.ts";

const router = Router();

router.use(requireCookieSession);

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
    res.json(await getCurrentDashboard(process.env.EA_USER_ID));
  } catch (err) {
    console.error("[Dashboard] current fetch failed:", err);
    res.status(500).json({ message: "Failed to fetch current dashboard data" });
  }
});

router.get("/health", timeRoute("/api/dashboard/health"), async (_req, res) => {
  try {
    res.json(await getDashboardSystemHealth(process.env.EA_USER_ID));
  } catch (err) {
    console.error("[Dashboard] health fetch failed:", err);
    res.status(500).json({ message: "Failed to fetch dashboard health" });
  }
});

router.post("/current/refresh", timeRoute("/api/dashboard/current/refresh"), async (_req, res) => {
  try {
    res.json(await requestCurrentDashboardRefresh(process.env.EA_USER_ID));
  } catch (err) {
    console.error("[Dashboard] current refresh request failed:", err);
    res.status(500).json({ message: "Failed to request current dashboard refresh" });
  }
});

router.post("/current/sync", timeRoute("/api/dashboard/current/sync"), async (_req, res) => {
  try {
    res.json(await syncCurrentDashboard(process.env.EA_USER_ID));
  } catch (err) {
    console.error("[Dashboard] current sync failed:", err);
    res.status(500).json({ message: "Failed to sync current dashboard data" });
  }
});

export default router;
