import { Router } from "express";
import * as emailService from "../../briefing/email-service.js";

const router = Router();
const EA_USER_ID = process.env.EA_USER_ID;

router.get("/email/:uid", async (req, res) => {
  try {
    res.json(await emailService.getEmailBody(EA_USER_ID, req.params.uid));
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) console.error("Error fetching email body:", err);
    res.status(status).json({ message: err.message });
  }
});

router.post("/dismiss/:emailId", async (req, res) => {
  try {
    await emailService.dismiss(EA_USER_ID, req.params.emailId);
    res.json({ ok: true });
  } catch (err) {
    console.error("Error dismissing email:", err);
    res.status(err.status || 500).json({ message: err.message });
  }
});

router.post("/pin/:emailId", async (req, res) => {
  try {
    await emailService.pin(EA_USER_ID, req.params.emailId, req.body?.snapshot);
    res.json({ ok: true });
  } catch (err) {
    console.error("Error pinning email:", err);
    res.status(err.status || 500).json({ message: err.message });
  }
});

router.delete("/pin/:emailId", async (req, res) => {
  try {
    await emailService.unpin(EA_USER_ID, req.params.emailId);
    res.json({ ok: true });
  } catch (err) {
    console.error("Error unpinning email:", err);
    res.status(err.status || 500).json({ message: err.message });
  }
});

router.post("/email/:uid/snooze", async (req, res) => {
  const untilTs = Number(req.body?.until_ts);
  if (!Number.isFinite(untilTs) || untilTs <= Date.now()) {
    return res.status(400).json({ message: "until_ts must be a future epoch millisecond value" });
  }
  try {
    await emailService.snooze(EA_USER_ID, req.params.uid, untilTs, req.body?.snapshot);
    res.json({ ok: true });
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) console.error("Error snoozing email:", err);
    res.status(status).json({ message: err.message });
  }
});

router.delete("/email/:uid/snooze", async (req, res) => {
  try {
    await emailService.wake(EA_USER_ID, req.params.uid);
    res.json({ ok: true });
  } catch (err) {
    console.error("Error unsnoozing email:", err);
    res.status(err.status || 500).json({ message: err.message });
  }
});

router.post("/email/:uid/mark-read", async (req, res) => {
  try {
    await emailService.markRead(EA_USER_ID, req.params.uid);
    res.json({ ok: true });
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) console.error("Error marking email as read:", err);
    res.status(status).json({ message: err.message });
  }
});

router.post("/email/:uid/mark-unread", async (req, res) => {
  try {
    await emailService.markUnread(EA_USER_ID, req.params.uid);
    res.json({ ok: true });
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) console.error("Error marking email as unread:", err);
    res.status(status).json({ message: err.message });
  }
});

router.post("/email/:uid/trash", async (req, res) => {
  try {
    await emailService.trash(EA_USER_ID, req.params.uid);
    res.json({ ok: true });
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) console.error("Error trashing email:", err);
    res.status(status).json({ message: err.message });
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
    res.status(err.status || 500).json({ message: err.message });
  }
});

router.get("/email-search", async (req, res) => {
  const { q, limit } = req.query;
  if (!q || !q.trim()) {
    return res.status(400).json({ message: "Query parameter 'q' is required" });
  }
  try {
    res.json(await emailService.searchEmails(EA_USER_ID, { q, limit }));
  } catch (err) {
    console.error("[EA] Email search error:", err.message);
    res.status(err.status || 500).json({ message: "Email search failed" });
  }
});

export default router;
