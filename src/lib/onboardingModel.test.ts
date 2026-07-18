import { describe, expect, it } from "vitest";
import { ONBOARDING_STEPS, projectOnboardingChecklist } from "./onboardingModel";
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
  it("keeps the locked capability order and selects the first unfinished step", () => {
    const checklist = projectOnboardingChecklist(progress);

    expect(ONBOARDING_STEPS.map((step) => step.id)).toEqual([
      "email_calendar",
      "ai",
      "tasks",
      "weather",
      "finances",
      "notifications",
      "advanced_delivery",
    ]);
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

  it("does not infer presentation completion from capability health", () => {
    const checklist = projectOnboardingChecklist(progress);
    expect(checklist.steps.find((step) => step.id === "weather")?.state).toBe("pending");
    expect(checklist.finished).toBe(false);
  });

  it("keeps an explicitly finished checklist finished even with pending steps", () => {
    const checklist = projectOnboardingChecklist({ ...progress, status: "complete", completedAt: 200 });
    expect(checklist.finished).toBe(true);
    expect(checklist.activeStepId).toBe("tasks");
  });

  it("routes every setup action to its exact settings card", () => {
    expect(Object.fromEntries(ONBOARDING_STEPS.map((step) => [step.id, step.settingsHref]))).toEqual({
      email_calendar: "/settings?tab=accounts#connected-accounts",
      ai: "/settings?tab=briefing#ai-provider-credentials",
      tasks: "/settings?tab=accounts#todoist-setup",
      weather: "/settings?tab=accounts#location-provider-credentials",
      finances: "/settings?tab=actual#actual-budget-connection",
      notifications: "/settings?tab=accounts#discord-reminders",
      advanced_delivery: "/settings?tab=accounts#gmail-realtime-delivery",
    });
  });
});
