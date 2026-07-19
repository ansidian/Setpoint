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

  it("routes every setup action to its exact provider-owned connection panel", () => {
    expect(Object.fromEntries(ONBOARDING_STEPS.map((step) => [step.id, step.targets]))).toEqual({
      email_calendar: [
        { connectionId: "google-workspace", label: "Google Workspace", href: "/settings?tab=connections#google-workspace" },
        { connectionId: "icloud-mail", label: "iCloud Mail", href: "/settings?tab=connections#icloud-mail" },
      ],
      ai: [
        { connectionId: "openai", label: "OpenAI", href: "/settings?tab=connections#openai" },
        { connectionId: "anthropic", label: "Anthropic", href: "/settings?tab=connections#anthropic" },
      ],
      tasks: [
        { connectionId: "todoist", label: "Todoist", href: "/settings?tab=connections#todoist" },
      ],
      weather: [
        { connectionId: "pirate-weather", label: "Pirate Weather", href: "/settings?tab=connections#pirate-weather" },
      ],
      finances: [
        { connectionId: "actual-budget", label: "Actual Budget", href: "/settings?tab=connections#actual-budget" },
      ],
      notifications: [
        { connectionId: "discord-reminders", label: "Discord Reminders", href: "/settings?tab=connections#discord-reminders" },
      ],
      advanced_delivery: [
        { connectionId: "google-workspace", label: "Gmail realtime", href: "/settings?tab=connections&setup=gmail-realtime#google-workspace" },
        { connectionId: "todoist", label: "Todoist advanced", href: "/settings?tab=connections&setup=todoist-advanced#todoist" },
        { connectionId: "google-places", label: "Google Places", href: "/settings?tab=connections#google-places" },
      ],
    });
  });

  it("continues only persisted in-progress onboarding work", () => {
    expect(onboardingContinueHref({
      ...progress,
      steps: { email_calendar: "reviewed", ai: "reviewed" },
    })).toBe("/onboarding?step=email_calendar");
    expect(onboardingContinueHref({ ...progress, steps: {} })).toBeNull();
    expect(onboardingContinueHref({ ...progress, steps: { advanced_delivery: "skipped" } })).toBeNull();
    expect(onboardingContinueHref({
      ...progress,
      status: "complete",
      steps: { email_calendar: "reviewed" },
      completedAt: 200,
    })).toBeNull();
  });
});
