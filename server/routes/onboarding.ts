import { Router } from "express";
import { getActiveOwner } from "../auth/owner-context.ts";
import { requireCookieSession } from "../middleware/auth.ts";
import { wrapRouterAsync } from "../middleware/async-handler.ts";
import {
  isOnboardingStepId,
  type OnboardingProgressMutation,
} from "../../shared/types/onboarding.ts";
import {
  onboardingProgressStore,
  type OnboardingProgressStore,
} from "../onboarding-progress-store.ts";

function parseMutation(body: unknown): OnboardingProgressMutation | null {
  if (!body || typeof body !== "object") return null;
  const { action, stepId } = body as Record<string, unknown>;
  if (action === "finish" || action === "reopen") return { action };
  if ((action === "review" || action === "complete" || action === "skip") && isOnboardingStepId(stepId)) {
    return { action, stepId };
  }
  return null;
}

export function createOnboardingRouter(
  store: Pick<OnboardingProgressStore, "get" | "update"> = onboardingProgressStore,
  ownerId: () => string | null = () => getActiveOwner()?.userId ?? null,
) {
  const router = Router();
  wrapRouterAsync(router);

  router.get("/", requireCookieSession, async (_req, res) => {
    const userId = ownerId();
    if (!userId) return res.status(409).json({ message: "Instance is not claimed" });
    return res.json(await store.get(userId));
  });

  router.patch("/", requireCookieSession, async (req, res) => {
    const userId = ownerId();
    if (!userId) return res.status(409).json({ message: "Instance is not claimed" });
    const mutation = parseMutation(req.body);
    if (!mutation) return res.status(400).json({ message: "Unsupported onboarding update" });
    return res.json(await store.update(userId, mutation));
  });

  return router;
}

export default createOnboardingRouter();
