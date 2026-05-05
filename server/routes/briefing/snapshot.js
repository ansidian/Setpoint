import { Router } from "express";
import * as snapshotService from "../../briefing/snapshot-service.js";
import { timeRoute } from "../../timing.js";

const router = Router();
const EA_USER_ID = process.env.EA_USER_ID;

router.get("/snapshot/history", timeRoute("/api/briefing/snapshot/history"), async (_req, res) => {
  try {
    res.json(await snapshotService.getSnapshotHistory(EA_USER_ID));
  } catch (err) {
    console.error("Error fetching snapshot history:", err);
    res.status(err.status || 500).json({ message: err.status ? err.message : "Failed to fetch snapshot history" });
  }
});

router.get("/snapshot/active", timeRoute("/api/briefing/snapshot/active"), async (_req, res) => {
  try {
    res.json(await snapshotService.getActiveSnapshotView(EA_USER_ID));
  } catch (err) {
    console.error("Error fetching active snapshot:", err);
    res.status(err.status || 500).json({ message: "Failed to fetch active snapshot" });
  }
});

router.post("/snapshot/sync", timeRoute("/api/briefing/snapshot/sync"), async (_req, res) => {
  try {
    res.json(await snapshotService.syncActiveSnapshot(EA_USER_ID));
  } catch (err) {
    console.error("Error syncing active snapshot:", err);
    res.status(err.status || 500).json({ message: "Failed to sync active snapshot" });
  }
});

router.get("/snapshot/:id", timeRoute("/api/briefing/snapshot/:id"), async (req, res) => {
  try {
    res.json(await snapshotService.getSnapshotViewById(EA_USER_ID, Number(req.params.id)));
  } catch (err) {
    console.error("Error fetching snapshot detail:", err);
    res.status(err.status || 500).json({ message: err.status ? err.message : "Failed to fetch snapshot" });
  }
});

router.patch("/snapshot/items/:itemId/lane", async (req, res) => {
  try {
    const itemId = Number(req.params.itemId);
    res.json(await snapshotService.moveSnapshotItemLane(EA_USER_ID, itemId, req.body?.lane));
  } catch (err) {
    console.error("Error moving snapshot item lane:", err);
    res.status(err.status || 500).json({ message: err.status ? err.message : "Failed to move snapshot item" });
  }
});

router.post("/snapshot/items/:itemId/dismiss", async (req, res) => {
  try {
    const itemId = Number(req.params.itemId);
    res.json(await snapshotService.dismissSnapshotItemForToday(EA_USER_ID, itemId));
  } catch (err) {
    console.error("Error dismissing snapshot item:", err);
    res.status(err.status || 500).json({ message: err.status ? err.message : "Failed to dismiss snapshot item" });
  }
});

router.post("/snapshot/items/:itemId/handled", async (req, res) => {
  try {
    const itemId = Number(req.params.itemId);
    res.json(await snapshotService.markSnapshotItemHandled(EA_USER_ID, itemId));
  } catch (err) {
    console.error("Error marking snapshot item handled:", err);
    res.status(err.status || 500).json({ message: err.status ? err.message : "Failed to mark snapshot item handled" });
  }
});

export default router;
