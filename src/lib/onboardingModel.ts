import type { CapabilityId } from "../../shared/types/capabilities";
import type {
  OnboardingProgress,
  OnboardingStepId,
  OnboardingStepState,
} from "../../shared/types/onboarding";

export interface OnboardingStepDefinition {
  id: OnboardingStepId;
  title: string;
  description: string;
  capabilityIds: CapabilityId[];
  settingsHref: string;
  actionLabel: string;
}

export const ONBOARDING_STEPS: OnboardingStepDefinition[] = [
  {
    id: "email_calendar",
    title: "Connect email and calendar",
    description: "Authorize Google once for Gmail and Calendar, or add an iCloud inbox.",
    capabilityIds: ["email_calendar"],
    settingsHref: "/settings",
    actionLabel: "Open account connections",
  },
  {
    id: "ai",
    title: "Enable AI features",
    description: "Add OpenAI, Anthropic, or both. Triage and extraction model choices stay in advanced Settings.",
    capabilityIds: ["ai"],
    settingsHref: "/settings",
    actionLabel: "Open AI credentials",
  },
  {
    id: "tasks",
    title: "Add tasks",
    description: "Start with a Todoist personal token. OAuth and webhooks remain optional advanced setup.",
    capabilityIds: ["tasks"],
    settingsHref: "/settings",
    actionLabel: "Open Todoist setup",
  },
  {
    id: "weather",
    title: "Add weather",
    description: "Choose a location and add Pirate Weather. Location search itself does not need a key.",
    capabilityIds: ["weather"],
    settingsHref: "/settings",
    actionLabel: "Open weather setup",
  },
  {
    id: "finances",
    title: "Connect finances",
    description: "Connect your existing Actual Budget server when you want bills and transactions in Setpoint.",
    capabilityIds: ["finances"],
    settingsHref: "/settings?tab=actual",
    actionLabel: "Open Actual Budget setup",
  },
  {
    id: "notifications",
    title: "Configure notifications",
    description: "Add a private Discord reminder destination, or leave notifications off for now.",
    capabilityIds: ["notifications"],
    settingsHref: "/settings",
    actionLabel: "Open notification setup",
  },
  {
    id: "advanced_delivery",
    title: "Optional delivery enhancements",
    description: "Real-time Gmail, Todoist OAuth/webhooks, and Calendar places are independent advanced options.",
    capabilityIds: ["gmail_realtime", "todoist_advanced", "calendar_places"],
    settingsHref: "/settings",
    actionLabel: "Open advanced setup",
  },
];

export function projectOnboardingChecklist(progress: OnboardingProgress) {
  const steps = ONBOARDING_STEPS.map((step) => ({
    ...step,
    state: (progress.steps[step.id] ?? "pending") as OnboardingStepState | "pending",
  }));
  return {
    steps,
    activeStepId: steps.find((step) => step.state === "pending" || step.state === "reviewed")?.id
      ?? steps[0]!.id,
    completedCount: steps.filter((step) => step.state === "completed" || step.state === "skipped").length,
    finished: progress.status === "complete",
  };
}
