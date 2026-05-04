import { Router } from "express";
import { requireCookieSession } from "../middleware/auth.js";
import {
  getCurrentDashboard,
  getDashboardSystemHealth,
  syncCurrentDashboard,
} from "../dashboard/current-service.js";
import { timeRoute } from "../timing.js";

const router = Router();

router.use(requireCookieSession);

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

router.post("/current/sync", timeRoute("/api/dashboard/current/sync"), async (_req, res) => {
  try {
    res.json(await syncCurrentDashboard(process.env.EA_USER_ID));
  } catch (err) {
    console.error("[Dashboard] current sync failed:", err);
    res.status(500).json({ message: "Failed to sync current dashboard data" });
  }
});

export default router;
