import { Router } from "express";
import {
  hasRecentAuth,
  requireCookieSession,
  requireRecentAuth,
} from "../middleware/auth.ts";
import { wrapRouterAsync } from "../middleware/async-handler.ts";
import { countPasskeys } from "../auth/passkey-store.ts";
import { getOwner } from "../auth/owner-store.ts";
import {
  buildCanonicalOriginImpact,
  canonicalUrlService,
  normalizeCanonicalOrigin,
} from "../platform/canonical-url.ts";

const router = Router();
wrapRouterAsync(router);

async function buildImpact(proposedOrigin: string) {
  const currentOrigin = await canonicalUrlService.resolveCanonicalOrigin(process.env);
  const owner = await getOwner();
  const affectedPasskeys = owner ? await countPasskeys(owner.userId) : 0;
  return buildCanonicalOriginImpact(currentOrigin, proposedOrigin, affectedPasskeys);
}

function requestedOrigin(value: unknown): string | null {
  try {
    return normalizeCanonicalOrigin(value);
  } catch {
    return null;
  }
}

router.get("/", requireCookieSession, async (req, res) => {
  const currentOrigin = await canonicalUrlService.resolveCanonicalOrigin(process.env);
  if (!currentOrigin) return res.status(409).json({ message: "Canonical URL is not configured" });
  return res.json({
    ...buildCanonicalOriginImpact(currentOrigin, currentOrigin, 0),
    recentAuth: await hasRecentAuth(req.cookies?.ea_session),
  });
});

router.post("/preview", requireCookieSession, async (req, res) => {
  const proposedOrigin = requestedOrigin(req.body?.canonicalOrigin);
  if (!proposedOrigin) return res.status(400).json({ message: "Canonical URL is invalid" });
  return res.json(await buildImpact(proposedOrigin));
});

router.patch("/", requireRecentAuth, async (req, res) => {
  const proposedOrigin = requestedOrigin(req.body?.canonicalOrigin);
  if (!proposedOrigin) return res.status(400).json({ message: "Canonical URL is invalid" });
  const impact = await buildImpact(proposedOrigin);
  await canonicalUrlService.setConfirmedOrigin(impact.proposedOrigin);
  return res.json(impact);
});

export default router;
