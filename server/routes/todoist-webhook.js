import { Router } from "express";
import { handleTodoistWebhookDelivery } from "../tasks/todoist-webhook.js";

const router = Router();

router.post("/", async (req, res) => {
  try {
    const result = await handleTodoistWebhookDelivery({
      userId: process.env.EA_USER_ID,
      rawBody: Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || ""),
      headers: req.headers,
    });
    res.json({ ok: true, duplicate: !!result.duplicate });
  } catch (err) {
    if (err.status === 503) {
      return res.status(503).json({ message: "Todoist webhook not configured" });
    }
    if (err.status === 401) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    if (err.status === 400) {
      return res.status(400).json({ message: err.message || "Invalid Todoist webhook" });
    }
    console.error("[Todoist] Webhook handling failed:", err.message);
    res.status(500).json({ message: "Todoist webhook failed" });
  }
});

export default router;
