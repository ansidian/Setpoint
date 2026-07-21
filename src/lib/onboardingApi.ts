import { isDemoMode } from "../demo/config.ts";
import { apiFetch } from "./apiFetch.ts";
import {
  ONBOARDING_VERSION,
  type OnboardingProgress,
  type OnboardingProgressMutation,
} from "../../shared/types/onboarding.ts";

let demoProgress: OnboardingProgress = {
  version: ONBOARDING_VERSION,
  status: "complete",
  steps: {},
  completedAt: 0,
  updatedAt: 0,
};

export const getOnboardingProgress = (): Promise<OnboardingProgress> => (
  isDemoMode() ? Promise.resolve(demoProgress) : apiFetch("/api/onboarding")
);

export const updateOnboardingProgress = (mutation: OnboardingProgressMutation): Promise<OnboardingProgress> => {
  if (!isDemoMode()) {
    return apiFetch("/api/onboarding", { method: "PATCH", body: JSON.stringify(mutation) });
  }
  const now = Date.now();
  const steps = { ...demoProgress.steps };
  let completedAt = demoProgress.completedAt;
  if (mutation.action === "finish") completedAt = now;
  else if (mutation.action === "reopen") completedAt = null;
  else if ("stepId" in mutation) {
    steps[mutation.stepId] = mutation.action === "skip" ? "skipped" : mutation.action === "complete" ? "completed" : "reviewed";
  }
  demoProgress = {
    version: ONBOARDING_VERSION,
    status: completedAt == null ? "in_progress" : "complete",
    steps,
    completedAt,
    updatedAt: now,
  };
  return Promise.resolve(demoProgress);
};
