import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  OnboardingProgress,
  OnboardingProgressMutation,
  OnboardingStepId,
} from "../../shared/types/onboarding";
import Onboarding from "./Onboarding";

const pending: OnboardingProgress = {
  version: 1,
  status: "in_progress",
  steps: {},
  completedAt: null,
  updatedAt: 0,
};

let serverProgress: OnboardingProgress;

function response(payload: unknown): Response {
  return { ok: true, status: 200, json: vi.fn().mockResolvedValue(payload) } as unknown as Response;
}

function installOnboardingServer(initial: OnboardingProgress): void {
  serverProgress = initial;
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input);
    if (path === "/api/capabilities") {
      return response({ generatedAt: "now", capabilities: [] });
    }
    if (path !== "/api/onboarding") throw new Error(`Unexpected request: ${path}`);
    if ((init?.method ?? "GET") === "GET") return response(serverProgress);

    const mutation = JSON.parse(String(init?.body)) as OnboardingProgressMutation;
    const steps = { ...serverProgress.steps };
    let completedAt = serverProgress.completedAt;
    if (mutation.action === "finish") completedAt = 100;
    else if (mutation.action === "reopen") completedAt = null;
    else if ("stepId" in mutation) {
      steps[mutation.stepId] = mutation.action === "skip" ? "skipped" : mutation.action === "complete" ? "completed" : "reviewed";
      const allStepIds: OnboardingStepId[] = [
        "email_calendar", "ai", "tasks", "weather", "finances", "notifications", "advanced_delivery",
      ];
      const allReviewed = allStepIds
        .every((stepId) => steps[stepId] === "completed");
      if (allReviewed) completedAt = 100;
    }
    serverProgress = {
      ...serverProgress,
      status: completedAt == null ? "in_progress" : "complete",
      steps,
      completedAt,
      updatedAt: serverProgress.updatedAt + 1,
    };
    return response(serverProgress);
  }));
}

function renderOnboarding(entry = "/onboarding"): void {
  render(<MemoryRouter initialEntries={[entry]}><Onboarding /></MemoryRouter>);
}

describe("Onboarding", () => {
  beforeEach(() => installOnboardingServer(pending));

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("persists skip state and advances without requiring a provider", async () => {
    renderOnboarding();
    await screen.findByRole("heading", { name: "Connect email and calendar" });

    fireEvent.click(screen.getByRole("button", { name: "Skip for now" }));

    expect(await screen.findByRole("heading", { name: "Enable AI features" })).toBeTruthy();
    expect(screen.getByText("Skipped")).toBeTruthy();
  });

  it("shows completion after reviewing the final checklist item", async () => {
    installOnboardingServer({
      ...pending,
      steps: {
        email_calendar: "completed",
        ai: "completed",
        tasks: "completed",
        weather: "completed",
        finances: "completed",
        notifications: "completed",
      },
    });

    renderOnboarding();
    expect(await screen.findByRole("heading", { name: "Optional delivery enhancements" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Mark reviewed" }));

    expect(await screen.findByRole("heading", { name: "Setup checklist complete" })).toBeTruthy();
    expect(screen.getByText("You reviewed every setup option.")).toBeTruthy();
  });

  it("keeps an explicit finish path when the final unresolved item is skipped", async () => {
    installOnboardingServer({
      ...pending,
      steps: {
        email_calendar: "completed",
        ai: "completed",
        tasks: "completed",
        weather: "completed",
        finances: "completed",
        notifications: "completed",
      },
    });

    renderOnboarding();
    expect(await screen.findByRole("heading", { name: "Optional delivery enhancements" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Skip for now" }));

    expect(await screen.findByRole("button", { name: "Finish onboarding" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Setup checklist complete" })).toBeNull();
  });

  it("finishes with every integration pending and can reopen the checklist", async () => {
    renderOnboarding();
    await screen.findByRole("heading", { name: "Connect email and calendar" });

    fireEvent.click(screen.getByRole("button", { name: "Finish onboarding" }));
    expect(await screen.findByRole("heading", { name: "Setup checklist complete" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Reopen checklist" }));
    expect(await screen.findByRole("heading", { name: "Connect email and calendar" })).toBeTruthy();
  });
});
