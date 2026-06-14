import { Router } from "express";
import {
  getEmailIndexHealth,
  queueEmailIndexBackfill,
} from "../../email/email-index.js";
import { wakeEmailBackfillWorker } from "../../email/email-backfill-worker.js";

const router = Router();
const EA_USER_ID = process.env.EA_USER_ID;

router.get("/email-index/health", async (_req, res) => {
  try {
    res.json(await getEmailIndexHealth(EA_USER_ID));
  } catch (err) {
    console.error("[EA] Email index health failed:", err.message);
    res.status(500).json({ message: "Email index health failed" });
  }
});

router.post("/email-index/backfill", async (req, res) => {
  try {
    const result = await queueEmailIndexBackfill(EA_USER_ID, {
      targetDays: req.body?.targetDays,
    });
    wakeEmailBackfillWorker();
    res.status(202).json(result);
  } catch (err) {
    console.error("[EA] Email index backfill trigger failed:", err.message);
    res.status(500).json({ message: "Email index backfill trigger failed" });
  }
});

export default router;
