import { Router } from "express";
import { requireCookieSession } from "../middleware/auth.ts";
import { alfredRunLimiter } from "../middleware/rate-limits.ts";
import { loadAlfredModelConfig } from "../alfred/alfred-models.ts";
import {
  createAlfredConversation,
  deleteAlfredConversation,
  getAlfredConversation,
} from "../alfred/alfred-conversations.ts";
import { runAlfred } from "../alfred/alfred-run.ts";
import { getAlfredUsageStats } from "../alfred/alfred-usage-stats.ts";
import { getEmailBody } from "../email/email-service.ts";
import { retrieveInboxAiSearch } from "../email/search/email-search-retrieval.ts";
import { htmlToPlainText } from "../email/html-to-text.ts";
import { fetchCalendar, pacificDayBoundaries } from "../calendar/calendar.ts";
import { loadUserConfig } from "../platform/config-service.ts";
import { readCalendarDeadlineRange } from "../tasks/deadlines-read.ts";
import { readBillsMirrorRange } from "../bills/bills-service.ts";
import { queryTransactions, summarizeTransactions } from "../transactions/transactions-service.ts";
import type { AlfredRunEvent } from "../../shared/types/alfred.ts";
import type { AlfredDependencies } from "../alfred/alfred-types.ts";
import { errorMessage } from "../alfred/alfred-types.ts";
import { resolveAiApiKey } from "../ai-credentials.ts";
import type { AlfredProvider } from "../../shared/types/alfred.ts";

const ALFRED_DEPS = {
  retrieve: retrieveInboxAiSearch,
  getEmailBody,
  htmlToPlainText,
  fetchCalendar,
  pacificDayBoundaries,
  loadUserConfig,
  readCalendarDeadlineRange,
  readBillsMirrorRange,
  queryTransactions,
  summarizeTransactions,
} as unknown as AlfredDependencies;

export function createAlfredRouter({
  deps = ALFRED_DEPS,
  run = runAlfred,
  credentialResolver = (provider) => resolveAiApiKey(provider),
  modelConfigResolver = (userId) => loadAlfredModelConfig(userId),
}: {
  deps?: AlfredDependencies;
  run?: typeof runAlfred;
  credentialResolver?: (provider: AlfredProvider) => Promise<string | null>;
  modelConfigResolver?: (userId: string) => Promise<{ provider: AlfredProvider; model: string }>;
} = {}) {
  const router = Router();
  router.use(requireCookieSession);

  router.post("/run", alfredRunLimiter, async (req, res) => {
    const userId = process.env.EA_USER_ID as string;
    const message = String(req.body?.message || "").trim();
    if (!message) return res.status(400).json({ message: "message is required" });

    const requestedId = req.body?.conversationId;
    let conversation = requestedId ? getAlfredConversation(requestedId) : null;
    if (!conversation) {
      const selection = await modelConfigResolver(userId);
      conversation = createAlfredConversation(selection);
    }
    const apiKey = await credentialResolver(conversation.provider);
    if (!apiKey) {
      const envVar = conversation.provider === "openai" ? "OPENAI_API_KEY" : "ANTHROPIC_API_KEY";
      return res.status(503).json({ message: `${envVar} is not configured` });
    }

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

    const emit = (event: AlfredRunEvent): void => {
      res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    };
    emit({
      type: "run_start",
      conversation_id: conversation.id,
      provider: conversation.provider,
      model: conversation.model,
    });

    try {
      await run({
        userId,
        conversation,
        message,
        emit,
        signal: abort.signal,
        apiKey,
        deps,
      });
    } catch (err) {
      if (!abort.signal.aborted) {
        console.error("[Alfred] run failed:", errorMessage(err, "run failed"));
        emit({ type: "run_error", message: "Alfred could not complete this run." });
      }
    } finally {
      res.end();
    }
    return undefined;
  });

  router.get("/usage", async (_req, res) => {
    try {
      res.json(await getAlfredUsageStats(process.env.EA_USER_ID as string));
    } catch (err) {
      console.error("Error fetching Alfred usage stats:", errorMessage(err, "usage stats failed"));
      res.status(500).json({ message: "Failed to fetch Alfred usage stats" });
    }
  });

  router.delete("/conversations/:id", (req, res) => {
    deleteAlfredConversation(req.params.id);
    res.json({ ok: true });
  });

  return router;
}

export default createAlfredRouter();
