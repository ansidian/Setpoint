import { Router } from "express";
import { enqueueHistorySyncFromPubSub } from "../briefing/gmail-sync.js";

const router = Router();

function bearerToken(req) {
  if (req.query.token) return req.query.token;
  if (req.headers["x-ea-pubsub-token"]) return req.headers["x-ea-pubsub-token"];
  const header = req.headers.authorization || "";
  if (header.startsWith("Bearer ")) return header.slice("Bearer ".length).trim();
  return "";
}

function verifyPushToken(req) {
  const expected = process.env.GMAIL_PUBSUB_PUSH_TOKEN;
  if (!expected) return process.env.NODE_ENV !== "production";
  return bearerToken(req) === expected;
}

router.post("/push", async (req, res) => {
  if (!verifyPushToken(req)) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  try {
    const queued = await enqueueHistorySyncFromPubSub(req.body);
    res.json({ ok: true, ...queued });
  } catch (err) {
    console.error("[Gmail Push] Failed to queue history sync:", err.message);
    res.status(400).json({ message: "Invalid Gmail Pub/Sub notification" });
  }
});

export default router;
