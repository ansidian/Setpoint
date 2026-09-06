import { describe, expect, it } from "vitest";
import {
  ONBOARDING_STEPS,
  onboardingContinueHref,
  projectOnboardingChecklist,
} from "./onboardingModel";
import type { OnboardingProgress } from "../../shared/types/onboarding";

const progress: OnboardingProgress = {
  version: 1,
  status: "in_progress",
  steps: {
    email_calendar: "completed",
    ai: "skipped",
  },
  completedAt: null,
  updatedAt: 100,
};

describe("onboarding model", () => {
  it("selects the first unfinished step and counts completed steps", () => {
    const checklist = projectOnboardingChecklist(progress);

    expect(checklist.activeStepId).toBe("tasks");
    expect(checklist.completedCount).toBe(1);
  });

  it("keeps skipped items incomplete after every other item is reviewed", () => {
    const checklist = projectOnboardingChecklist({
      ...progress,
      steps: Object.fromEntries(ONBOARDING_STEPS.map((step) => [
        step.id,
        step.id === "ai" ? "skipped" : "completed",
      ])),
    });

    expect(checklist.activeStepId).toBe("ai");
    expect(checklist.completedCount).toBe(ONBOARDING_STEPS.length - 1);
    expect(checklist.finished).toBe(false);
  });

  it("always offers a return to the active step while onboarding is unfinished", () => {
    expect(onboardingContinueHref({
      ...progress,
      steps: { email_calendar: "reviewed", ai: "reviewed" },
    })).toBe("/onboarding?step=email_calendar");
    expect(onboardingContinueHref({ ...progress, steps: {} })).toBe("/onboarding?step=email_calendar");
    expect(onboardingContinueHref({ ...progress, steps: { email_calendar: "completed" } }))
      .toBe("/onboarding?step=ai");
    expect(onboardingContinueHref({ ...progress, steps: { advanced_delivery: "skipped" } }))
      .toBe("/onboarding?step=email_calendar");
    expect(onboardingContinueHref({
      ...progress,
      status: "complete",
      steps: { email_calendar: "reviewed" },
      completedAt: 200,
    })).toBeNull();
  });
});
