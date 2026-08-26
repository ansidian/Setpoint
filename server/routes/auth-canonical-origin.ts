import { Router } from "express";
import {
  hasRecentPasswordAuth,
  requireCookieSession,
  requireRecentPasswordAuth,
  type SessionSecurityContext,
} from "../middleware/auth.ts";
import { wrapRouterAsync } from "../middleware/async-handler.ts";
import { countPasskeys } from "../auth/passkey-store.ts";
import { getOwner } from "../auth/owner-store.ts";
import { ownerSecurityTransitionService } from "../auth/security-transition.ts";
import { clearSessionCookie, issueSessionCookie } from "../auth/session-cookie.ts";
import {
  buildCanonicalOriginImpact,
  canonicalUrlService,
  createCanonicalUrlService,
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
    recentAuth: await hasRecentPasswordAuth(req.cookies?.ea_session),
  });
});

router.post("/preview", requireCookieSession, async (req, res) => {
  const proposedOrigin = requestedOrigin(req.body?.canonicalOrigin);
  if (!proposedOrigin) return res.status(400).json({ message: "Canonical URL is invalid" });
  return res.json(await buildImpact(proposedOrigin));
});

router.patch("/", requireRecentPasswordAuth, async (req, res) => {
  const proposedOrigin = requestedOrigin(req.body?.canonicalOrigin);
  if (!proposedOrigin) return res.status(400).json({ message: "Canonical URL is invalid" });
  const impact = await buildImpact(proposedOrigin);
  if (impact.currentOrigin === impact.proposedOrigin) return res.json(impact);
  const owner = await getOwner();
  if (!owner) return res.status(409).json({ message: "Instance is not claimed" });
  const session = res.locals.authSession as SessionSecurityContext | undefined;
  if (!session || owner.securityGeneration !== session.securityGeneration) {
    clearSessionCookie(res);
    return res.status(409).json({
      code: "SECURITY_STATE_CHANGED",
      message: "Security state changed; sign in and try again",
    });
  }
  const nextGeneration = await ownerSecurityTransitionService.transition({
    userId: owner.userId,
    expectedGeneration: session.securityGeneration,
    mutate: async (tx) => {
      await createCanonicalUrlService(tx).setConfirmedOrigin(impact.proposedOrigin);
    },
  });
  if (!nextGeneration || !await issueSessionCookie(res, {
    securityGeneration: nextGeneration,
    authMethod: "password",
    passwordAuthenticatedAt: session.passwordAuthenticatedAt,
  })) {
    clearSessionCookie(res);
    return res.status(409).json({
      code: "SECURITY_STATE_CHANGED",
      message: "Security state changed; sign in and try again",
    });
  }
  return res.json(impact);
});

export default router;
