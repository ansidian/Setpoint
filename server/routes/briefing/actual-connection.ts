import { Router, type RequestHandler } from "express";
import { requireRecentPasswordAuth } from "../../middleware/auth.ts";
import * as billsService from "../../bills/bills-service.ts";
import { validateActualBudgetUrl } from "../../platform/settings-schemas.ts";
import { actualConnectionLimiter } from "../../middleware/rate-limits.ts";

type HttpError = Error & { status?: number };

const ownerUserId = (): string => process.env.EA_USER_ID!;

export function createActualConnectionRouter({
  service = billsService,
  recentAuth = requireRecentPasswordAuth,
  connectionLimiter = actualConnectionLimiter,
}: {
  service?: typeof billsService;
  recentAuth?: RequestHandler;
  connectionLimiter?: RequestHandler;
} = {}) {
const router = Router();

router.post("/actual/test", recentAuth, connectionLimiter, async (req, res) => {
  const { serverURL, password, syncId, encryptionPassword } = req.body || {};
  if (encryptionPassword !== undefined && encryptionPassword !== null && typeof encryptionPassword !== "string") {
    return res.status(400).json({ message: "Actual Budget encryption password must be a string", success: false });
  }
  if (serverURL) {
    const validation = validateActualBudgetUrl(serverURL);
    if (!validation.valid) {
      return res.status(400).json({ message: validation.message, success: false });
    }
  }
  const overrides = serverURL && syncId
    ? { serverURL, password, syncId, ...(encryptionPassword !== undefined ? { encryptionPassword } : {}) }
    : null;
  try {
    res.json(await service.testConnection(ownerUserId(), overrides));
  } catch (error: unknown) {
    const err = error as HttpError;
    console.error("Actual Budget test failed:", err.message);
    res.status(err.status || 400).json({ message: err.message || "Connection failed", success: false });
  }
});

router.post("/actual/connection", recentAuth, connectionLimiter, async (req, res) => {
  const { serverURL, password, syncId, encryptionPassword } = req.body || {};
  if (typeof serverURL !== "string" || typeof syncId !== "string") {
    return res.status(400).json({ message: "Actual Budget server URL and sync ID are required" });
  }
  if (password !== undefined && typeof password !== "string") {
    return res.status(400).json({ message: "Actual Budget password must be a string" });
  }
  if (encryptionPassword !== undefined && encryptionPassword !== null && typeof encryptionPassword !== "string") {
    return res.status(400).json({ message: "Actual Budget encryption password must be a string" });
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
      ...(encryptionPassword !== undefined ? { encryptionPassword } : {}),
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

return router;
}

export default createActualConnectionRouter();
