import { Router } from "express";
import {
  getEmailIndexHealth,
  queueEmailIndexBackfill,
} from "../../email/email-index.ts";
import { wakeEmailBackfillWorker } from "../../email/email-backfill-worker.ts";

const ownerUserId = (): string => process.env.EA_USER_ID!;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || "");
}

export function createEmailIndexRouter({
  getHealth = getEmailIndexHealth,
  queueBackfill = queueEmailIndexBackfill,
  wake = wakeEmailBackfillWorker,
}: {
  getHealth?: typeof getEmailIndexHealth;
  queueBackfill?: typeof queueEmailIndexBackfill;
  wake?: typeof wakeEmailBackfillWorker;
} = {}) {
  const router = Router();

router.get("/email-index/health", async (_req, res) => {
  try {
    res.json(await getHealth(ownerUserId()));
  } catch (err) {
    console.error("[EA] Email index health failed:", errorMessage(err));
    res.status(500).json({ message: "Email index health failed" });
  }
});

router.post("/email-index/backfill", async (req, res) => {
  try {
    const result = await queueBackfill(ownerUserId(), {
      targetDays: req.body?.targetDays,
    });
    wake();
    res.status(202).json(result);
  } catch (err) {
    console.error("[EA] Email index backfill trigger failed:", errorMessage(err));
    res.status(500).json({ message: "Email index backfill trigger failed" });
  }
});

  return router;
}

export default createEmailIndexRouter();
