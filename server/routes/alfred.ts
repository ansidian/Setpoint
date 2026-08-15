import { Router } from "express";
import { requireCookieSession } from "../middleware/auth.ts";
import { alfredEmailContextLimiter, alfredRunLimiter } from "../middleware/rate-limits.ts";
import { loadAlfredModelConfig } from "../alfred/alfred-models.ts";
import {
  createAlfredConversation,
  deleteAlfredConversation,
  getAlfredConversation,
  acknowledgeAlfredCalendarProposalCreated,
  alfredConversationExpiresAt,
} from "../alfred/alfred-conversations.ts";
import { runAlfred } from "../alfred/alfred-run.ts";
import { getAlfredUsageStats } from "../alfred/alfred-usage-stats.ts";
import { getEmailBody } from "../email/email-service.ts";
import { retrieveInboxAiSearch } from "../email/search/email-search-retrieval.ts";
import { htmlToPlainText } from "../email/html-to-text.ts";
import { fetchCalendar, getCalendarSourceGroups, pacificDayBoundaries } from "../calendar/calendar.ts";
import { loadUserConfig } from "../platform/config-service.ts";
import { readCalendarDeadlineRange } from "../tasks/deadlines-read.ts";
import { readBillsMirrorRange } from "../bills/bills-service.ts";
import { queryTransactions, summarizeTransactions } from "../transactions/transactions-service.ts";
import type { AlfredRunEvent } from "../../shared/types/alfred.ts";
import type { AlfredDependencies } from "../alfred/alfred-types.ts";
import { errorMessage } from "../alfred/alfred-types.ts";
import { resolveAiApiKey } from "../ai-credentials.ts";
import type { AlfredProvider } from "../../shared/types/alfred.ts";
import { prepareAlfredEmailContext } from "../alfred/alfred-email-context.ts";
import {
  claimAlfredEmailContext,
  consumeAlfredEmailContext,
  discardAlfredEmailContext,
  releaseAlfredEmailContext,
} from "../alfred/alfred-email-context-store.ts";
import { isContextWindowError } from "../alfred/alfred-types.ts";

const ALFRED_DEPS = {
  retrieve: retrieveInboxAiSearch,
  getEmailBody,
  htmlToPlainText,
  fetchCalendar,
  pacificDayBoundaries,
  loadUserConfig,
  getCalendarSourceGroups,
  readCalendarDeadlineRange,
  readBillsMirrorRange,
  queryTransactions,
  summarizeTransactions,
} as unknown as AlfredDependencies;

const EMAIL_CONTEXT_DEPS = { getEmailBody };

function errorStatus(error: unknown, fallback = 500): number {
  return error && typeof error === "object" && "status" in error && typeof error.status === "number"
    ? error.status || fallback
    : fallback;
}

function errorCode(error: unknown): string | undefined {
  return error && typeof error === "object" && "code" in error && error.code
    ? String(error.code)
    : undefined;
}

export function createAlfredRouter({
  deps = ALFRED_DEPS,
  run = runAlfred,
  credentialResolver = (provider) => resolveAiApiKey(provider),
  modelConfigResolver = (userId) => loadAlfredModelConfig(userId),
  emailContextDeps = EMAIL_CONTEXT_DEPS,
}: {
  deps?: AlfredDependencies;
  run?: typeof runAlfred;
  credentialResolver?: (provider: AlfredProvider) => Promise<string | null>;
  modelConfigResolver?: (userId: string) => Promise<{ provider: AlfredProvider; model: string }>;
  emailContextDeps?: { getEmailBody: typeof getEmailBody };
} = {}) {
  const router = Router();
  router.use(requireCookieSession);

  router.post("/email-context", alfredEmailContextLimiter, async (req, res) => {
    try {
      const context = await prepareAlfredEmailContext({
        userId: process.env.EA_USER_ID as string,
        source: req.body,
        deps: emailContextDeps,
      });
      res.status(201).json(context);
    } catch (err) {
      const status = errorStatus(err);
      if (status >= 500) console.error("[Alfred] email context preparation failed:", errorMessage(err));
      res.status(status).json({ message: errorMessage(err), code: errorCode(err) });
    }
  });

  router.delete("/email-context/:id", (req, res) => {
    discardAlfredEmailContext(req.params.id, process.env.EA_USER_ID as string);
    res.json({ ok: true });
  });

  router.post("/run", alfredRunLimiter, async (req, res) => {
    const userId = process.env.EA_USER_ID as string;
    const message = String(req.body?.message || "").trim();
    if (!message) return res.status(400).json({ message: "message is required" });

    const requestedContextId = String(req.body?.emailContextId || "").trim();
    const contextClaim = requestedContextId
      ? claimAlfredEmailContext(requestedContextId, userId)
      : null;
    if (contextClaim?.status === "missing") {
      return res.status(409).json({
        message: "This email attachment expired. Prepare it again before sending.",
        code: "email_context_expired",
      });
    }
    if (contextClaim?.status === "busy") {
      return res.status(409).json({
        message: "This email attachment is already being used by another Alfred run.",
        code: "email_context_busy",
      });
    }
    const emailContext = contextClaim?.status === "ok" ? contextClaim.context : null;

    const requestedId = req.body?.conversationId;
    let conversation = requestedId ? getAlfredConversation(requestedId) : null;
    let apiKey: string | null;
    try {
      if (!conversation) {
        const selection = await modelConfigResolver(userId);
        conversation = createAlfredConversation(selection);
      }
      apiKey = await credentialResolver(conversation.provider);
    } catch (err) {
      if (emailContext) releaseAlfredEmailContext(emailContext.contextId, userId);
      const status = errorStatus(err);
      if (status >= 500) console.error("[Alfred] run setup failed:", errorMessage(err));
      return res.status(status).json({
        message: status >= 500 ? "Alfred could not start this run." : errorMessage(err),
        code: errorCode(err),
      });
    }
    if (!apiKey) {
      if (emailContext) releaseAlfredEmailContext(emailContext.contextId, userId);
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

    let completed = false;
    const emit = (event: AlfredRunEvent): void => {
      if (event.type === "run_end") completed = true;
      res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    };
    emit({
      type: "run_start",
      conversation_id: conversation.id,
      provider: conversation.provider,
      model: conversation.model,
      expires_at: alfredConversationExpiresAt(conversation),
    });

    const locallyCreatedProposalIds = Array.isArray(req.body?.createdProposalIds)
      ? req.body.createdProposalIds.map(String).filter(Boolean).slice(0, 8)
      : [];
    locallyCreatedProposalIds.forEach((proposalId) => {
      acknowledgeAlfredCalendarProposalCreated(conversation, proposalId);
    });

    try {
      await run({
        userId,
        conversation,
        message,
        emailContext,
        emit,
        signal: abort.signal,
        apiKey,
        deps,
      });
    } catch (err) {
      if (!abort.signal.aborted) {
        console.error("[Alfred] run failed:", errorMessage(err, "run failed"));
        if (isContextWindowError(err)) {
          emit({
            type: "run_error",
            code: "context_window_exceeded",
            message: "This chat is too long for the selected model. Start a new chat and try again.",
          });
        } else {
          emit({ type: "run_error", message: "Alfred could not complete this run." });
        }
      }
    } finally {
      if (emailContext) {
        if (completed) consumeAlfredEmailContext(emailContext.contextId, userId);
        else releaseAlfredEmailContext(emailContext.contextId, userId);
      }
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

  router.post("/conversations/:id/proposals/:proposalId/created", (req, res) => {
    if (req.body && Object.keys(req.body).length > 0) {
      return res.status(400).json({ message: "Created acknowledgement accepts identity only" });
    }
    const conversation = getAlfredConversation(req.params.id);
    if (!conversation) return res.status(404).json({ message: "Alfred conversation not found" });
    const status = acknowledgeAlfredCalendarProposalCreated(conversation, req.params.proposalId);
    if (status === "missing") return res.status(404).json({ message: "Alfred proposal not found" });
    return res.json({ ok: true, status });
  });

  return router;
}

export default createAlfredRouter();
