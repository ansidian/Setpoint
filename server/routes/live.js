import { Router } from "express";
import { requireCookieSession } from "../middleware/auth.js";
import { timeRoute } from "../timing.js";

const router = Router();

router.use(timeRoute("/api/live/all"));
router.use(requireCookieSession);

router.get("/all", (_req, res) => {
  res.status(410).json({
    code: "LIVE_ROUTE_RETIRED",
    message: "/api/live/all is retired. Use /api/dashboard/current for current dashboard data.",
  });
});

export default router;
