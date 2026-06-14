import { Router } from "express";
import { requireCookieSession } from "../middleware/auth.js";
import { resolveAlfredModel } from "../alfred/alfred-models.js";
import {
  createAlfredConversation,
  deleteAlfredConversation,
  getAlfredConversation,
} from "../alfred/alfred-conversations.js";
import { runAlfred } from "../alfred/alfred-run.js";
import { getEmailBody } from "../email/email-service.js";
import { retrieveInboxAiSearch } from "../email/search/email-search-retrieval.js";
import { htmlToPlainText } from "../email/html-to-text.js";
import { fetchCalendar, pacificDayBoundaries } from "../calendar/calendar.js";
import { loadUserConfig } from "../platform/config-service.js";
import { readCalendarDeadlineRange } from "../tasks/deadlines-read.js";
import { readBillsMirrorRange } from "../bills/bills-service.js";

const ALFRED_DEPS = {
  retrieve: retrieveInboxAiSearch,
  getEmailBody,
  htmlToPlainText,
  fetchCalendar,
  pacificDayBoundaries,
  loadUserConfig,
  readCalendarDeadlineRange,
  readBillsMirrorRange,
};

export function createAlfredRouter({ deps = ALFRED_DEPS, run = runAlfred } = {}) {
  const router = Router();
  router.use(requireCookieSession);

  router.post("/run", async (req, res) => {
    const userId = process.env.EA_USER_ID;
    const message = String(req.body?.message || "").trim();
    if (!message) return res.status(400).json({ message: "message is required" });
    const model = resolveAlfredModel(req.body?.model);
    if (!model) return res.status(400).json({ message: "Unknown model" });
    if (!process.env.ANTHROPIC_API_KEY) {
      return res.status(503).json({ message: "ANTHROPIC_API_KEY is not configured" });
    }

    const requestedId = req.body?.conversationId;
    const conversation = (requestedId && getAlfredConversation(requestedId)) || createAlfredConversation();

    res.status(200);
    res.set({
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.flushHeaders?.();

    const abort = new AbortController();
    req.on("close", () => abort.abort());

    const emit = (event) => {
      res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    };
    emit({ type: "run_start", conversation_id: conversation.id, model });

    try {
      await run({
        userId,
        conversation,
        message,
        model,
        emit,
        signal: abort.signal,
        deps,
      });
    } catch (err) {
      if (!abort.signal.aborted) {
        console.error("[Alfred] run failed:", err.message);
        emit({ type: "run_error", message: "Alfred could not complete this run." });
      }
    } finally {
      res.end();
    }
    return undefined;
  });

  router.delete("/conversations/:id", (req, res) => {
    deleteAlfredConversation(req.params.id);
    res.json({ ok: true });
  });

  return router;
}

export default createAlfredRouter();
