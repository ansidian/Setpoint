import { Router } from "express";
import * as emailService from "../../email/email-service.ts";
import { emailSearchLimiter } from "../../middleware/rate-limits.ts";
import type { PinnedEmailSnapshot } from "../../../shared/types/email.ts";

const router = Router();
const EA_USER_ID = process.env.EA_USER_ID!;

function errorStatus(error: unknown, fallback = 500): number {
  return error && typeof error === "object" && "status" in error && typeof error.status === "number"
    ? error.status || fallback
    : fallback;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

router.get("/email/:uid", async (req, res) => {
  try {
    res.json(await emailService.getEmailBody(EA_USER_ID, req.params.uid!));
  } catch (err) {
    const status = errorStatus(err);
    if (status >= 500) console.error("Error fetching email body:", err);
    res.status(status).json({ message: errorMessage(err) });
  }
});

router.post("/dismiss/:emailId", async (req, res) => {
  try {
    await emailService.dismiss(EA_USER_ID, req.params.emailId!);
    res.json({ ok: true });
  } catch (err) {
    console.error("Error dismissing email:", err);
    res.status(errorStatus(err)).json({ message: errorMessage(err) });
  }
});

router.post("/email/:uid/snooze", async (req, res) => {
  const untilTs = Number(req.body?.until_ts);
  if (!Number.isFinite(untilTs) || untilTs <= Date.now()) {
    return res.status(400).json({ message: "until_ts must be a future epoch millisecond value" });
  }
  try {
    await emailService.snooze(EA_USER_ID, req.params.uid!, untilTs, (req.body?.snapshot ?? null) as PinnedEmailSnapshot | null);
    res.json({ ok: true });
  } catch (err) {
    const status = errorStatus(err);
    if (status >= 500) console.error("Error snoozing email:", err);
    res.status(status).json({ message: errorMessage(err) });
  }
});

router.delete("/email/:uid/snooze", async (req, res) => {
  try {
    await emailService.wake(EA_USER_ID, req.params.uid!);
    res.json({ ok: true });
  } catch (err) {
    console.error("Error unsnoozing email:", err);
    res.status(errorStatus(err)).json({ message: errorMessage(err) });
  }
});

router.post("/email/:uid/pin", async (req, res) => {
  try {
    await emailService.pin(EA_USER_ID, req.params.uid!, (req.body?.snapshot ?? null) as PinnedEmailSnapshot | null);
    res.json({ ok: true });
  } catch (err) {
    const status = errorStatus(err);
    if (status >= 500) console.error("Error pinning email:", err);
    res.status(status).json({ message: errorMessage(err) });
  }
});

router.delete("/email/:uid/pin", async (req, res) => {
  try {
    await emailService.unpin(EA_USER_ID, req.params.uid!);
    res.json({ ok: true });
  } catch (err) {
    const status = errorStatus(err);
    if (status >= 500) console.error("Error unpinning email:", err);
    res.status(status).json({ message: errorMessage(err) });
  }
});

router.post("/email/:uid/mark-read", async (req, res) => {
  try {
    await emailService.markRead(EA_USER_ID, req.params.uid!);
    res.json({ ok: true });
  } catch (err) {
    const status = errorStatus(err);
    if (status >= 500) console.error("Error marking email as read:", err);
    res.status(status).json({ message: errorMessage(err) });
  }
});

router.post("/email/:uid/mark-unread", async (req, res) => {
  try {
    await emailService.markUnread(EA_USER_ID, req.params.uid!);
    res.json({ ok: true });
  } catch (err) {
    const status = errorStatus(err);
    if (status >= 500) console.error("Error marking email as unread:", err);
    res.status(status).json({ message: errorMessage(err) });
  }
});

router.post("/email/:uid/trash", async (req, res) => {
  try {
    await emailService.trash(EA_USER_ID, req.params.uid!);
    res.json({ ok: true });
  } catch (err) {
    const status = errorStatus(err);
    if (status >= 500) console.error("Error trashing email:", err);
    res.status(status).json({ message: errorMessage(err) });
  }
});

router.post("/email/mark-all-read", async (req, res) => {
  const { uids } = req.body;
  if (!Array.isArray(uids) || !uids.length) {
    return res.status(400).json({ message: "uids array required" });
  }
  try {
    const result = await emailService.markAllRead(EA_USER_ID, uids);
    res.json({
      ok: !result.failed?.length,
      updatedUids: result.updatedUids || [],
      failed: result.failed || [],
    });
  } catch (err) {
    console.error("Error marking all emails as read:", err);
    res.status(errorStatus(err)).json({ message: errorMessage(err) });
  }
});

router.post("/email/arrival-grace/settle", async (_req, res) => {
  try {
    res.json({ ok: true, ...(await emailService.settleArrivalGrace(EA_USER_ID)) });
  } catch (err) {
    console.error("Error settling arrival-grace email:", err);
    res.status(errorStatus(err)).json({ message: errorMessage(err) });
  }
});

router.get("/email-search", emailSearchLimiter, async (req, res) => {
  const { q, limit, offset, debug } = req.query as { q?: string; limit?: string; offset?: string; debug?: string };
  if (!q || !q.trim()) {
    return res.status(400).json({ message: "Query parameter 'q' is required" });
  }
  try {
    res.json(await emailService.searchEmails(EA_USER_ID, { q, limit, offset, debug: debug === "1" }));
  } catch (err) {
    console.error("[EA] Email search error:", errorMessage(err));
    const status = errorStatus(err);
    res.status(status).json({ message: status < 500 ? errorMessage(err) : "Email search failed" });
  }
});

export default router;
