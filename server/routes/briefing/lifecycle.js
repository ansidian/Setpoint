import { Router } from "express";
import * as lifecycleService from "../../briefing/lifecycle-service.js";
import { timeRoute } from "../../timing.js";

const router = Router();
const EA_USER_ID = process.env.EA_USER_ID;

router.post("/generate", async (_req, res) => {
  try {
    res.json(await lifecycleService.triggerGeneration(EA_USER_ID));
  } catch (err) {
    console.error("Error triggering briefing:", err);
    res.status(err.status || 500).json({ message: "Failed to trigger briefing generation" });
  }
});

router.get("/in-progress", async (_req, res) => {
  try {
    res.json(await lifecycleService.getInProgress(EA_USER_ID));
  } catch (err) {
    console.error("[Briefing] Error checking generation status:", err.message);
    res.json({ generating: false });
  }
});

router.post("/refresh", async (_req, res) => {
  try {
    res.json(await lifecycleService.refresh(EA_USER_ID));
  } catch (err) {
    console.error("Error refreshing briefing:", err);
    res.status(err.status || 500).json({ message: "Failed to refresh briefing data" });
  }
});

router.get("/latest", timeRoute("/api/briefing/latest"), async (req, res) => {
  try {
    res.json(await lifecycleService.getLatest(EA_USER_ID));
  } catch (err) {
    console.error("Error fetching latest briefing:", err);
    res.status(err.status || 500).json({ message: "Failed to fetch latest briefing" });
  }
});

router.get("/history", async (_req, res) => {
  try {
    res.json(await lifecycleService.getHistory(EA_USER_ID));
  } catch (err) {
    console.error("Error fetching briefing history:", err);
    res.status(err.status || 500).json({ message: "Failed to fetch briefing history" });
  }
});

router.get("/status/:id", async (req, res) => {
  try {
    res.json(await lifecycleService.getStatus(EA_USER_ID, req.params.id));
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) console.error("Error fetching briefing status:", err);
    res.status(status).json({ message: err.message || "Failed to fetch briefing status" });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    await lifecycleService.deleteBriefing(EA_USER_ID, req.params.id);
    res.json({ ok: true });
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) console.error("Error deleting briefing:", err);
    res.status(status).json({ message: err.message || "Failed to delete briefing" });
  }
});

router.get("/:id", async (req, res) => {
  try {
    res.json(await lifecycleService.getById(EA_USER_ID, req.params.id));
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) console.error("Error fetching briefing by ID:", err);
    res.status(status).json({ message: err.message || "Failed to fetch briefing" });
  }
});

export default router;
