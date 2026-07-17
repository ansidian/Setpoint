import { Router } from "express";
import * as devService from "../../email/dev-service.ts";

const router = Router();
const ownerUserId = (): string => process.env.EA_USER_ID!;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

router.post("/dev-reindex-emails", async (req, res) => {
  if (process.env.NODE_ENV === "production") {
    return res.status(404).json({ message: "Not found" });
  }
  const hoursBack = Math.min(parseInt(req.query.hours as string) || 720, 2160);
  try {
    const result = await devService.reindexEmails(ownerUserId(), hoursBack);
    res.json(result);
  } catch (err) {
    console.error("[EA] Dev reindex failed:", err);
    res.status(500).json({ message: errorMessage(err) });
  }
});

export default router;
