import { Router } from "express";
import * as snapshotService from "../../snapshots/snapshot-service.ts";
import { errorMessage, errorStatus } from "../../snapshots/snapshot-types.ts";
import { timeRoute } from "../../timing.ts";

const ownerUserId = (): string => process.env.EA_USER_ID!;

export function createSnapshotRouter(service: typeof snapshotService = snapshotService) {
const router = Router();

router.get("/snapshot/history", timeRoute("/api/briefing/snapshot/history"), async (_req, res) => {
  try {
    res.json(await service.getSnapshotHistory(ownerUserId()));
  } catch (err) {
    console.error("Error fetching snapshot history:", err);
    const status = errorStatus(err);
    res.status(status || 500).json({ message: status ? errorMessage(err) : "Failed to fetch snapshot history" });
  }
});

router.get("/snapshot/active", timeRoute("/api/briefing/snapshot/active"), async (_req, res) => {
  try {
    res.json(await service.getActiveSnapshotView(ownerUserId()));
  } catch (err) {
    console.error("Error fetching active snapshot:", err);
    res.status(errorStatus(err) || 500).json({ message: "Failed to fetch active snapshot" });
  }
});

router.post("/snapshot/sync", timeRoute("/api/briefing/snapshot/sync"), async (_req, res) => {
  try {
    res.json(await service.syncActiveSnapshot(ownerUserId()));
  } catch (err) {
    console.error("Error syncing active snapshot:", err);
    res.status(errorStatus(err) || 500).json({ message: "Failed to sync active snapshot" });
  }
});

router.get("/snapshot/:id", timeRoute("/api/briefing/snapshot/:id"), async (req, res) => {
  try {
    res.json(await service.getSnapshotViewById(ownerUserId(), Number(req.params.id)));
  } catch (err) {
    console.error("Error fetching snapshot detail:", err);
    const status = errorStatus(err);
    res.status(status || 500).json({ message: status ? errorMessage(err) : "Failed to fetch snapshot" });
  }
});

router.patch("/snapshot/items/:itemId/lane", async (req, res) => {
  try {
    const itemId = Number(req.params.itemId);
    res.json(await service.moveSnapshotItemLane(ownerUserId(), itemId, req.body?.lane));
  } catch (err) {
    console.error("Error moving snapshot item lane:", err);
    const status = errorStatus(err);
    res.status(status || 500).json({ message: status ? errorMessage(err) : "Failed to move snapshot item" });
  }
});

router.post("/snapshot/items/:itemId/dismiss", async (req, res) => {
  try {
    const itemId = Number(req.params.itemId);
    res.json(await service.dismissSnapshotItemForToday(ownerUserId(), itemId));
  } catch (err) {
    console.error("Error dismissing snapshot item:", err);
    const status = errorStatus(err);
    res.status(status || 500).json({ message: status ? errorMessage(err) : "Failed to dismiss snapshot item" });
  }
});

router.post("/snapshot/items/:itemId/restore", async (req, res) => {
  try {
    const itemId = Number(req.params.itemId);
    res.json(await service.restoreSnapshotItemForToday(ownerUserId(), itemId));
  } catch (err) {
    console.error("Error restoring snapshot item:", err);
    const status = errorStatus(err);
    res.status(status || 500).json({ message: status ? errorMessage(err) : "Failed to restore snapshot item" });
  }
});

router.post("/snapshot/items/:itemId/handled", async (req, res) => {
  try {
    const itemId = Number(req.params.itemId);
    res.json(await service.markSnapshotItemHandled(ownerUserId(), itemId));
  } catch (err) {
    console.error("Error marking snapshot item handled:", err);
    const status = errorStatus(err);
    res.status(status || 500).json({ message: status ? errorMessage(err) : "Failed to mark snapshot item handled" });
  }
});

router.post("/snapshot/items/:itemId/reopen", async (req, res) => {
  try {
    const itemId = Number(req.params.itemId);
    res.json(await service.reopenSnapshotItem(ownerUserId(), itemId));
  } catch (err) {
    console.error("Error reopening snapshot item:", err);
    const status = errorStatus(err);
    res.status(status || 500).json({ message: status ? errorMessage(err) : "Failed to reopen snapshot item" });
  }
});

return router;
}

export default createSnapshotRouter();
