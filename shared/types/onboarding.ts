export const ONBOARDING_VERSION = 1 as const;

export const ONBOARDING_STEP_IDS = [
  "email_calendar",
  "ai",
  "tasks",
  "weather",
  "finances",
  "notifications",
  "advanced_delivery",
] as const;

export type OnboardingStepId = typeof ONBOARDING_STEP_IDS[number];
export type OnboardingStepState = "reviewed" | "completed" | "skipped";
export type OnboardingProgressStatus = "in_progress" | "complete";

export interface OnboardingProgress {
  version: typeof ONBOARDING_VERSION;
  status: OnboardingProgressStatus;
  steps: Partial<Record<OnboardingStepId, OnboardingStepState>>;
  completedAt: number | null;
  updatedAt: number;
}

export type OnboardingProgressMutation =
  | { action: "review" | "complete" | "skip"; stepId: OnboardingStepId }
  | { action: "finish" | "reopen" };

export function isOnboardingStepId(value: unknown): value is OnboardingStepId {
  return typeof value === "string" && (ONBOARDING_STEP_IDS as readonly string[]).includes(value);
}
