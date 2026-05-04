import { Router } from "express";
import * as snapshotService from "../../briefing/snapshot-service.js";
import { timeRoute } from "../../timing.js";

const router = Router();
const EA_USER_ID = process.env.EA_USER_ID;

router.get("/snapshot/active", timeRoute("/api/briefing/snapshot/active"), async (_req, res) => {
  try {
    res.json(await snapshotService.getActiveSnapshotView(EA_USER_ID));
  } catch (err) {
    console.error("Error fetching active snapshot:", err);
    res.status(err.status || 500).json({ message: "Failed to fetch active snapshot" });
  }
});

router.post("/snapshot/sync", async (_req, res) => {
  try {
    res.json(await snapshotService.syncActiveSnapshot(EA_USER_ID));
  } catch (err) {
    console.error("Error syncing active snapshot:", err);
    res.status(err.status || 500).json({ message: "Failed to sync active snapshot" });
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
