import { Router } from "express";
import { transactionImportService } from "../../transaction-imports/transaction-import-service.ts";
import { requestTransactionImportDrain } from "../../transaction-imports/transaction-import-runtime.ts";
import { resolveManagedFinancialPlan } from "../../financial-events/financial-event-status.ts";
import { financialEventCompletion } from "../../financial-events/financial-event-completion.ts";
import { readFinancialReviewChanges } from "../../financial-events/financial-event-review.ts";

type HttpError = Error & { status?: number };
type Service = typeof transactionImportService;

const ownerUserId = (): string => process.env.EA_USER_ID!;
function nonnegativeInteger(value: unknown): number | null {
  if (typeof value !== "string" || !/^\d+$/.test(value)) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : null;
}

function errorResponse(res: Parameters<Parameters<Router["get"]>[1]>[1], error: unknown): void {
  const err = error as HttpError;
  res.status(err.status || 500).json({ message: err.message || "Transaction import request failed" });
}

export function createTransactionImportRouter({
  service = transactionImportService,
  wake = requestTransactionImportDrain,
  financialStatus = resolveManagedFinancialPlan,
  financialCompletion = financialEventCompletion,
  financialReviewChanges = readFinancialReviewChanges,
  financialDismissal = financialEventCompletion.dismiss,
}: {
  service?: Service;
  wake?: () => void;
  financialStatus?: typeof resolveManagedFinancialPlan;
  financialCompletion?: Pick<typeof financialEventCompletion, "complete">;
  financialDismissal?: typeof financialEventCompletion.dismiss;
  financialReviewChanges?: typeof readFinancialReviewChanges;
} = {}): Router {
  const router = Router();

  router.get("/financial-events/review-changes", async (req, res) => {
    const hasCursor = req.query.afterAt !== undefined || req.query.afterId !== undefined;
    const updatedAt = hasCursor ? nonnegativeInteger(req.query.afterAt) : null;
    const id = req.query.afterId;
    if (hasCursor && (updatedAt === null || typeof id !== "string" || id.length > 600)) {
      return res.status(400).json({ message: "Financial review cursor is invalid" });
    }
    try {
      res.json(await financialReviewChanges(ownerUserId(), {
        ...(hasCursor ? { after: { updatedAt: updatedAt!, id: id as string } } : {}),
      }));
    } catch (error) {
      errorResponse(res, error);
    }
  });

  router.post("/financial-events/dismiss", async (req, res) => {
    try {
      res.json(await financialDismissal(ownerUserId(), req.body));
    } catch (error) { errorResponse(res, error); }
  });

  router.post("/financial-events/complete", async (req, res) => {
    try {
      const plan = await financialCompletion.complete(ownerUserId(), req.body);
      wake();
      res.status(202).json(plan);
    } catch (error) {
      errorResponse(res, error);
    }
  });

  router.get("/transaction-imports/email-status", async (req, res) => {
    const emailUid = typeof req.query.emailUid === "string" ? req.query.emailUid.trim() : "";
    if (!emailUid || emailUid.length > 500) {
      return res.status(400).json({ message: "A valid email UID is required" });
    }
    try {
      const [items, plan] = await Promise.all([
        service.listItemsForEmail(ownerUserId(), emailUid), financialStatus(ownerUserId(), emailUid),
      ]);
      const financialEvent = plan?.workflow?.state === "settled" && !plan.workflow.correction && !plan.candidate.event_kind ? null : plan;
      res.json({ emailUid, items, financialEvent });
    } catch (error) {
      errorResponse(res, error);
    }
  });

  router.post("/transaction-imports/runs/:runId/commit", async (req, res) => {
    if (!Array.isArray(req.body?.items)) return res.status(400).json({ message: "items are required" });
    try {
      const result = await service.commitItems(ownerUserId(), req.params.runId, req.body.items);
      wake();
      res.status(202).json(result);
    } catch (error) {
      errorResponse(res, error);
    }
  });

  router.post("/transaction-imports/items/:itemId/retry", async (req, res) => {
    try {
      const result = await service.retryItem(ownerUserId(), req.params.itemId);
      if (!result.accepted) return res.status(409).json({ message: "Transaction import item is not retryable" });
      wake();
      res.status(202).json(result);
    } catch (error) {
      errorResponse(res, error);
    }
  });

  router.post("/transaction-imports/items/:itemId/dismiss", async (req, res) => {
    try {
      const result = await service.dismissItem(ownerUserId(), req.params.itemId);
      if (!result.dismissed) return res.status(409).json({ message: "Transaction import item cannot be dismissed" });
      res.json(result);
    } catch (error) {
      errorResponse(res, error);
    }
  });

  return router;
}

export default createTransactionImportRouter();
