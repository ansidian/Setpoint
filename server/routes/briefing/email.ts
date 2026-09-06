import { Router } from "express";
import * as emailService from "../../email/email-service.ts";
import { emailAttachmentLimiter, emailSearchLimiter } from "../../middleware/rate-limits.ts";
import type { PinnedEmailSnapshot } from "../../../shared/types/email.ts";

const router = Router();
const ownerUserId = (): string => process.env.EA_USER_ID!;

function errorStatus(error: unknown, fallback = 500): number {
  return error && typeof error === "object" && "status" in error && typeof error.status === "number"
    ? error.status || fallback
    : fallback;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function safeAttachmentFilename(value: unknown): string {
  const filename = String(value || "attachment")
    .split(/[\\/]/)
    .pop()!
    .split("")
    .filter((character) => {
      const code = character.charCodeAt(0);
      return code >= 32 && code !== 127;
    })
    .join("")
    .trim();
  return filename.slice(0, 240) || "attachment";
}

function safeAttachmentContentType(value: unknown): string {
  const contentType = String(value || "").trim().toLowerCase();
  return /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/i.test(contentType)
    ? contentType
    : "application/octet-stream";
}

router.get("/email/remote-content-trust", async (_req, res) => {
  try {
    res.json(await emailService.listRemoteContentTrust(ownerUserId()));
  } catch (err) {
    console.error("Error listing remote-content trust:", err);
    res.status(errorStatus(err)).json({ message: errorMessage(err) });
  }
});

router.post("/email/remote-content-trust", async (req, res) => {
  try {
    const entry = await emailService.trustRemoteContentSender(
      ownerUserId(),
      req.body?.account_id,
      req.body?.sender_address,
    );
    res.status(201).json({ ok: true, entry });
  } catch (err) {
    const status = errorStatus(err);
    if (status >= 500) console.error("Error trusting remote-content sender:", err);
    res.status(status).json({ message: errorMessage(err) });
  }
});

router.delete("/email/remote-content-trust/:id", async (req, res) => {
  try {
    await emailService.removeRemoteContentTrust(ownerUserId(), req.params.id);
    res.json({ ok: true });
  } catch (err) {
    const status = errorStatus(err);
    if (status >= 500) console.error("Error removing remote-content trust:", err);
    res.status(status).json({ message: errorMessage(err) });
  }
});

router.get("/email/snoozed", async (_req, res) => {
  try {
    res.json(await emailService.loadSnoozedEntries(ownerUserId()));
  } catch (err) {
    res.status(errorStatus(err)).json({ message: errorMessage(err) });
  }
});

router.get("/email/:uid", async (req, res) => {
  try {
    res.json(await emailService.getEmailBody(ownerUserId(), req.params.uid!));
  } catch (err) {
    const status = errorStatus(err);
    if (status >= 500) console.error("Error fetching email body:", err);
    res.status(status).json({ message: errorMessage(err) });
  }
});

router.get("/email/:uid/attachments/:attachmentId", emailAttachmentLimiter, async (req, res) => {
  const attachmentId = req.params.attachmentId!;
  if (!/^(?:[1-9]\d*(?:\.[1-9]\d*)*|attachment-[1-9]\d*)$/.test(attachmentId)) {
    return res.status(400).json({ message: "Invalid attachment id" });
  }

  try {
    const attachment = await emailService.getEmailAttachment(
      ownerUserId(),
      req.params.uid!,
      attachmentId,
    );
    const filename = safeAttachmentFilename(attachment.filename);
    res.attachment(filename);
    res.set({
      "Cache-Control": "private, no-store, no-transform",
      "Content-Type": safeAttachmentContentType(attachment.contentType),
      "Content-Length": String(attachment.size),
      "X-Content-Type-Options": "nosniff",
    });
    return res.send(attachment.content);
  } catch (err) {
    const status = errorStatus(err, 502);
    if (status >= 500) console.error("Error fetching email attachment");
    return res.status(status).json({
      message: status >= 500 ? "Attachment download failed" : errorMessage(err),
    });
  }
});

router.post("/dismiss/:emailId", async (req, res) => {
  try {
    await emailService.dismiss(ownerUserId(), req.params.emailId!);
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
    await emailService.snooze(ownerUserId(), req.params.uid!, untilTs, (req.body?.snapshot ?? null) as PinnedEmailSnapshot | null);
    res.json({ ok: true });
  } catch (err) {
    const status = errorStatus(err);
    if (status >= 500) console.error("Error snoozing email:", err);
    res.status(status).json({ message: errorMessage(err) });
  }
});

router.delete("/email/:uid/snooze", async (req, res) => {
  try {
    await emailService.wake(ownerUserId(), req.params.uid!);
    res.json({ ok: true });
  } catch (err) {
    console.error("Error unsnoozing email:", err);
    res.status(errorStatus(err)).json({ message: errorMessage(err) });
  }
});

router.post("/email/:uid/pin", async (req, res) => {
  try {
    await emailService.pin(ownerUserId(), req.params.uid!, (req.body?.snapshot ?? null) as PinnedEmailSnapshot | null);
    res.json({ ok: true });
  } catch (err) {
    const status = errorStatus(err);
    if (status >= 500) console.error("Error pinning email:", err);
    res.status(status).json({ message: errorMessage(err) });
  }
});

router.delete("/email/:uid/pin", async (req, res) => {
  try {
    await emailService.unpin(ownerUserId(), req.params.uid!);
    res.json({ ok: true });
  } catch (err) {
    const status = errorStatus(err);
    if (status >= 500) console.error("Error unpinning email:", err);
    res.status(status).json({ message: errorMessage(err) });
  }
});

router.post("/email/:uid/mark-read", async (req, res) => {
  try {
    await emailService.markRead(ownerUserId(), req.params.uid!);
    res.json({ ok: true });
  } catch (err) {
    const status = errorStatus(err);
    if (status >= 500) console.error("Error marking email as read:", err);
    res.status(status).json({ message: errorMessage(err) });
  }
});

router.post("/email/:uid/mark-unread", async (req, res) => {
  try {
    await emailService.markUnread(ownerUserId(), req.params.uid!);
    res.json({ ok: true });
  } catch (err) {
    const status = errorStatus(err);
    if (status >= 500) console.error("Error marking email as unread:", err);
    res.status(status).json({ message: errorMessage(err) });
  }
});

router.post("/email/:uid/trash", async (req, res) => {
  try {
    await emailService.trash(ownerUserId(), req.params.uid!);
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
    const result = await emailService.markAllRead(ownerUserId(), uids);
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
    res.json({ ok: true, ...(await emailService.settleArrivalGrace(ownerUserId())) });
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
    res.json(await emailService.searchEmails(ownerUserId(), { q, limit, offset, debug: debug === "1" }));
  } catch (err) {
    console.error("[EA] Email search error:", errorMessage(err));
    const status = errorStatus(err);
    res.status(status).json({ message: status < 500 ? errorMessage(err) : "Email search failed" });
  }
});

export default router;
