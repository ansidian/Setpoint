import { Router } from "express";
import type { Request } from "express";
import { gmailPubSubService, type GmailPubSubService } from "../email/gmail-pubsub.ts";
import { enqueueHistorySyncFromPubSub } from "../email/gmail-sync.ts";
import { requestGmailHistorySyncDrain } from "../scheduler.ts";

function bearerToken(req: Request): string {
  if (req.query.token) return String(req.query.token);
  if (req.headers["x-ea-pubsub-token"]) return String(req.headers["x-ea-pubsub-token"]);
  const header = req.headers.authorization || "";
  if (header.startsWith("Bearer ")) return header.slice("Bearer ".length).trim();
  return "";
}

export function createGmailPushRouter(pubSubService: GmailPubSubService = gmailPubSubService) {
  const router = Router();
  router.post("/push", async (req, res) => {
    let verified = false;
    try {
      verified = await pubSubService.verifyToken(bearerToken(req));
    } catch {
      console.error("[Gmail Push] Token verification unavailable");
      return res.status(503).json({ message: "Gmail Pub/Sub verification unavailable" });
    }
    if (!verified) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    try {
      const queued = await enqueueHistorySyncFromPubSub(req.body);
      res.json({ ok: true, ...queued });
      requestGmailHistorySyncDrain();
    } catch (err) {
      console.error("[Gmail Push] Failed to queue history sync:", err instanceof Error ? err.message : String(err));
      res.status(400).json({ message: "Invalid Gmail Pub/Sub notification" });
    }
  });
  return router;
}

export default createGmailPushRouter();
