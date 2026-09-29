import { Router, type RequestHandler } from "express";
import {
  requireCookieSessionOrApiTokenScope,
  requireRecentPasswordAuth,
} from "../../middleware/auth.ts";
import * as billsService from "../../bills/bills-service.ts";
import { validateActualBudgetUrl } from "../../platform/settings-schemas.ts";
import { actualConnectionLimiter } from "../../middleware/rate-limits.ts";

type HttpError = Error & { status?: number };

const ownerUserId = (): string => process.env.EA_USER_ID!;

export function createBillsRouters({
  service = billsService,
  recentAuth = requireRecentPasswordAuth,
  quickTxnAuth = requireCookieSessionOrApiTokenScope("actual:write"),
  connectionLimiter = actualConnectionLimiter,
}: {
  service?: typeof billsService;
  recentAuth?: RequestHandler;
  quickTxnAuth?: RequestHandler;
  connectionLimiter?: RequestHandler;
} = {}) {
const router = Router();
const quickTxnRouter = Router();

quickTxnRouter.post("/actual/quick-txn", quickTxnAuth, async (req, res) => {
  const { account, amount, payee, type, date, notes, category } = req.body || {};
  if (!account || amount == null || !payee) {
    return res.status(400).json({ message: "account, amount, and payee are required" });
  }
  const numericAmount = Number(amount);
  if (!Number.isFinite(numericAmount)) {
    return res.status(400).json({ message: "amount must be a number" });
  }
  // Reject zero/negative quick-txn amounts before createQuickTxn — stops $0
  // writes and silent Math.abs.
  if (numericAmount <= 0) {
    return res.status(400).json({ message: "amount must be greater than 0" });
  }
  try {
    const result = await service.createQuickTxn(ownerUserId(), {
      accountName: account,
      amount: numericAmount,
      payee: String(payee),
      type: type === "deposit" ? "deposit" : "payment",
      date,
      notes,
      categoryName: category || null,
    });
    res.json(result);
  } catch (error: unknown) {
    const err = error as HttpError;
    const status = err.status || 500;
    if (status >= 500) console.error("[EA] quick-txn error:", err);
    res.status(status).json({ message: err.message });
  }
});

router.post("/bills/resolve", async (req, res) => {
  const {
    emailId,
    accountId,
    subject,
    from,
    body,
    snippet,
    candidate,
    source = "triage",
  } = req.body || {};
  try {
    res.json(await service.resolveFinancialEmailSeed(ownerUserId(), {
      emailId,
      accountId,
      subject,
      from,
      body,
      snippet,
      candidate,
      source,
    }));
  } catch (error: unknown) {
    const err = error as HttpError;
    const status = err.status || 500;
    if (status >= 500) console.error("Error resolving bill pay:", err);
    res.status(status).json({ message: err.message });
  }
});

router.post("/actual/bills/:id/mark-paid", async (req, res) => {
  try {
    res.json(await service.markBillPaid(ownerUserId(), req.params.id));
  } catch (error: unknown) {
    const err = error as HttpError;
    console.error("Error marking bill paid:", err);
    res.status(err.status || 500).json({ message: err.message });
  }
});

router.get("/actual/metadata", async (_req, res) => {
  try {
    res.json(await service.getMetadata(ownerUserId()));
  } catch (error: unknown) {
    const err = error as HttpError;
    console.error("Error fetching Actual Budget metadata:", err.message);
    res.status(err.status || 500).json({ message: err.message });
  }
});

router.get("/actual/accounts", async (_req, res) => {
  try {
    res.json(await service.listAccounts(ownerUserId()));
  } catch (error: unknown) {
    const err = error as HttpError;
    console.error("Error fetching Actual Budget accounts:", err.message);
    res.status(err.status || 500).json({ message: err.message });
  }
});

router.get("/actual/payees", async (_req, res) => {
  try {
    res.json(await service.listPayees(ownerUserId()));
  } catch (error: unknown) {
    const err = error as HttpError;
    console.error("Error fetching Actual Budget payees:", err.message);
    res.status(err.status || 500).json({ message: err.message });
  }
});

router.get("/actual/categories", async (_req, res) => {
  try {
    res.json(await service.listCategories(ownerUserId()));
  } catch (error: unknown) {
    const err = error as HttpError;
    console.error("Error fetching Actual Budget categories:", err.message);
    res.status(err.status || 500).json({ message: err.message });
  }
});

router.post("/actual/test", recentAuth, connectionLimiter, async (req, res) => {
  const { serverURL, password, syncId } = req.body || {};
  if (serverURL) {
    const validation = validateActualBudgetUrl(serverURL);
    if (!validation.valid) {
      return res.status(400).json({ message: validation.message, success: false });
    }
  }
  const overrides = serverURL && syncId ? { serverURL, password, syncId } : null;
  try {
    res.json(await service.testConnection(ownerUserId(), overrides));
  } catch (error: unknown) {
    const err = error as HttpError;
    console.error("Actual Budget test failed:", err.message);
    res.status(err.status || 400).json({ message: err.message || "Connection failed", success: false });
  }
});

router.post("/actual/connection", recentAuth, connectionLimiter, async (req, res) => {
  const { serverURL, password, syncId } = req.body || {};
  if (typeof serverURL !== "string" || typeof syncId !== "string") {
    return res.status(400).json({ message: "Actual Budget server URL and sync ID are required" });
  }
  if (password !== undefined && typeof password !== "string") {
    return res.status(400).json({ message: "Actual Budget password must be a string" });
  }
  const validation = validateActualBudgetUrl(serverURL);
  if (!validation.valid) {
    return res.status(400).json({ message: validation.message, success: false });
  }
  if (!syncId.trim()) {
    return res.status(400).json({ message: "Actual Budget sync ID is required", success: false });
  }
  try {
    return res.json(await service.saveActualConnection(ownerUserId(), {
      serverURL: validation.value!,
      password,
      syncId: syncId.trim(),
    }));
  } catch (error: unknown) {
    const err = error as HttpError;
    console.error("Actual Budget connection save failed:", err.message);
    return res.status(err.status || 400).json({
      message: err.message || "Actual Budget connection could not be saved",
      success: false,
    });
  }
});

router.delete("/actual/connection", recentAuth, async (_req, res) => {
  try {
    return res.json(await service.removeActualConnection(ownerUserId()));
  } catch (error: unknown) {
    const err = error as HttpError;
    console.error("Actual Budget connection removal failed:", err.message);
    return res.status(err.status || 500).json({ message: "Actual Budget credentials could not be removed" });
  }
});

router.post("/actual/cache/hydrate", async (_req, res) => {
  try {
    res.json(await service.hydrateActualCache(ownerUserId()));
  } catch (error: unknown) {
    const err = error as HttpError;
    console.error("Actual Budget cache hydration failed:", err.message);
    res.status(err.status || 500).json({ message: err.message || "Actual Budget cache hydration failed" });
  }
});

router.get("/actual/cache/status", async (_req, res) => {
  try {
    res.json(await service.getActualCacheStatus(ownerUserId()));
  } catch (error: unknown) {
    const err = error as HttpError;
    console.error("Actual Budget cache status check failed:", err.message);
    res.status(err.status || 500).json({ message: err.message || "Actual Budget cache status check failed" });
  }
});

return { router, quickTxnRouter };
}

const defaultRouters = createBillsRouters();
export const quickTxnRouter = defaultRouters.quickTxnRouter;
export default defaultRouters.router;
