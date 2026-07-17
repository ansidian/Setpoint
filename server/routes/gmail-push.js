import crypto from "crypto";
import { Router } from "express";
import { enqueueHistorySyncFromPubSub } from "../email/gmail-sync.js";
import { requestGmailHistorySyncDrain } from "../scheduler.ts";

const router = Router();

function bearerToken(req) {
  if (req.query.token) return req.query.token;
  if (req.headers["x-ea-pubsub-token"]) return req.headers["x-ea-pubsub-token"];
  const header = req.headers.authorization || "";
  if (header.startsWith("Bearer ")) return header.slice("Bearer ".length).trim();
  return "";
}

// Constant-time token compare. Hash both sides first so the timingSafeEqual
// buffers are always equal length (sha256 digests are fixed 32 bytes),
// avoiding both the length leak and the throw on mismatched lengths.
// Mirrors the safeEqual pattern in server/tasks/todoist-webhook.js.
function safeEqualToken(candidate, expected) {
  if (!candidate || !expected) return false;
  const left = crypto.createHash("sha256").update(String(candidate)).digest();
  const right = crypto.createHash("sha256").update(String(expected)).digest();
  return crypto.timingSafeEqual(left, right);
}

function verifyPushToken(req) {
  const expected = process.env.GMAIL_PUBSUB_PUSH_TOKEN;
  if (!expected) return false;
  return safeEqualToken(bearerToken(req), expected);
}

router.post("/push", async (req, res) => {
  if (!verifyPushToken(req)) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  try {
    const queued = await enqueueHistorySyncFromPubSub(req.body);
    res.json({ ok: true, ...queued });
    requestGmailHistorySyncDrain();
  } catch (err) {
    console.error("[Gmail Push] Failed to queue history sync:", err.message);
    res.status(400).json({ message: "Invalid Gmail Pub/Sub notification" });
  }
});

export default router;
