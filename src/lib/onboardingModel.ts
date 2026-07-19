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
  targets: OnboardingConnectionTarget[];
}

export type OnboardingConnectionId =
  | "google-workspace"
  | "icloud-mail"
  | "todoist"
  | "actual-budget"
  | "openai"
  | "anthropic"
  | "discord-reminders"
  | "pirate-weather"
  | "google-places";

export interface OnboardingConnectionTarget {
  connectionId: OnboardingConnectionId;
  label: string;
  href: string;
}

export const ONBOARDING_STEPS: OnboardingStepDefinition[] = [
  {
    id: "email_calendar",
    title: "Connect email and calendar",
    description: "Authorize Google once for Gmail and Calendar, or add an iCloud inbox.",
    capabilityIds: ["email_calendar"],
    targets: [
      { connectionId: "google-workspace", label: "Google Workspace", href: "/settings?tab=connections#google-workspace" },
      { connectionId: "icloud-mail", label: "iCloud Mail", href: "/settings?tab=connections#icloud-mail" },
    ],
  },
  {
    id: "ai",
    title: "Enable AI features",
    description: "Add OpenAI, Anthropic, or both. Triage and extraction model choices stay in Automation.",
    capabilityIds: ["ai"],
    targets: [
      { connectionId: "openai", label: "OpenAI", href: "/settings?tab=connections#openai" },
      { connectionId: "anthropic", label: "Anthropic", href: "/settings?tab=connections#anthropic" },
    ],
  },
  {
    id: "tasks",
    title: "Add tasks",
    description: "Start with a Todoist personal token. OAuth and webhooks remain optional advanced setup.",
    capabilityIds: ["tasks"],
    targets: [
      { connectionId: "todoist", label: "Todoist", href: "/settings?tab=connections#todoist" },
    ],
  },
  {
    id: "weather",
    title: "Add weather",
    description: "Choose a location and add Pirate Weather. Location search itself does not need a key.",
    capabilityIds: ["weather"],
    targets: [
      { connectionId: "pirate-weather", label: "Pirate Weather", href: "/settings?tab=connections#pirate-weather" },
    ],
  },
  {
    id: "finances",
    title: "Connect finances",
    description: "Connect your existing Actual Budget server when you want bills and transactions in Setpoint.",
    capabilityIds: ["finances"],
    targets: [
      { connectionId: "actual-budget", label: "Actual Budget", href: "/settings?tab=connections#actual-budget" },
    ],
  },
  {
    id: "notifications",
    title: "Configure notifications",
    description: "Add a private Discord reminder destination, or leave notifications off for now.",
    capabilityIds: ["notifications"],
    targets: [
      { connectionId: "discord-reminders", label: "Discord Reminders", href: "/settings?tab=connections#discord-reminders" },
    ],
  },
  {
    id: "advanced_delivery",
    title: "Optional delivery enhancements",
    description: "Real-time Gmail, Todoist OAuth/webhooks, and Calendar places are independent advanced options.",
    capabilityIds: ["gmail_realtime", "todoist_advanced", "calendar_places"],
    targets: [
      { connectionId: "google-workspace", label: "Gmail realtime", href: "/settings?tab=connections&setup=gmail-realtime#google-workspace" },
      { connectionId: "todoist", label: "Todoist advanced", href: "/settings?tab=connections&setup=todoist-advanced#todoist" },
      { connectionId: "google-places", label: "Google Places", href: "/settings?tab=connections#google-places" },
    ],
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
      ?? steps.find((step) => step.state === "skipped")?.id
      ?? steps[0]!.id,
    completedCount: steps.filter((step) => step.state === "completed").length,
    finished: progress.status === "complete",
  };
}

export function onboardingContinueHref(progress: OnboardingProgress): string | null {
  if (progress.status === "complete") return null;
  const inProgressStep = ONBOARDING_STEPS.find((step) => progress.steps[step.id] === "reviewed");
  return inProgressStep ? `/onboarding?step=${inProgressStep.id}` : null;
}
