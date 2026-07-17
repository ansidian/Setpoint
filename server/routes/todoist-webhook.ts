import { Router } from "express";
import { handleTodoistWebhookDelivery } from "../tasks/todoist-webhook.ts";

const router = Router();

function errorDetails(error: unknown): { message: string; status?: number } {
  if (error instanceof Error) {
    return {
      message: error.message,
      status: "status" in error && typeof error.status === "number" ? error.status : undefined,
    };
  }
  return { message: String(error) };
}

router.post("/", async (req, res) => {
  try {
    const result = await handleTodoistWebhookDelivery({
      userId: process.env.EA_USER_ID,
      rawBody: Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || ""),
      headers: req.headers,
    });
    res.json({ ok: true, duplicate: !!result.duplicate });
  } catch (err) {
    const { message, status } = errorDetails(err);
    if (status === 503) {
      return res.status(503).json({ message: "Todoist webhook not configured" });
    }
    if (status === 401) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    if (status === 400) {
      return res.status(400).json({ message: message || "Invalid Todoist webhook" });
    }
    console.error("[Todoist] Webhook handling failed:", message);
    res.status(500).json({ message: "Todoist webhook failed" });
  }
});

export default router;
