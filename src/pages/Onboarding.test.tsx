import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";
import type { OnboardingProgress } from "../../shared/types/onboarding";

const api = vi.hoisted(() => ({
  getCapabilities: vi.fn(),
  getOnboardingProgress: vi.fn(),
  updateOnboardingProgress: vi.fn(),
}));

vi.mock("../api", () => api);
vi.mock("../lib/onboardingApi", () => ({
  getOnboardingProgress: api.getOnboardingProgress,
  updateOnboardingProgress: api.updateOnboardingProgress,
}));

const { default: Onboarding } = await import("./Onboarding");

const pending: OnboardingProgress = {
  version: 1,
  status: "in_progress",
  steps: {},
  completedAt: null,
  updatedAt: 0,
};

describe("Onboarding", () => {
  afterEach(cleanup);
  beforeEach(() => {
    api.getOnboardingProgress.mockResolvedValue(pending);
    api.getCapabilities.mockResolvedValue({ generatedAt: "now", capabilities: [] });
    api.updateOnboardingProgress.mockImplementation(async (mutation) => ({
      ...pending,
      steps: mutation.stepId ? { [mutation.stepId]: mutation.action === "skip" ? "skipped" : "completed" } : {},
      status: mutation.action === "finish" ? "complete" : "in_progress",
      completedAt: mutation.action === "finish" ? 100 : null,
    }));
  });

  it("renders the capability-led sequence and uses the existing Settings workflow", async () => {
    render(<MemoryRouter><Onboarding /></MemoryRouter>);

    expect(await screen.findByRole("heading", { name: "Connect email and calendar" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open account connections" }).getAttribute("href")).toBe("/settings?tab=accounts#connected-accounts");
    expect(screen.getByRole("button", { name: /Enable AI features/ })).toBeTruthy();
  });

  it("persists skip state and advances without requiring a provider", async () => {
    render(<MemoryRouter><Onboarding /></MemoryRouter>);
    await screen.findByRole("heading", { name: "Connect email and calendar" });

    fireEvent.click(screen.getByRole("button", { name: "Skip for now" }));

    await waitFor(() => expect(api.updateOnboardingProgress).toHaveBeenCalledWith({
      action: "skip",
      stepId: "email_calendar",
    }));
    expect(await screen.findByRole("heading", { name: "Enable AI features" })).toBeTruthy();
  });

  it("shows the completion state after reviewing the final checklist item", async () => {
    const finalStep: OnboardingProgress = {
      ...pending,
      steps: {
        email_calendar: "completed",
        ai: "completed",
        tasks: "completed",
        weather: "completed",
        finances: "completed",
        notifications: "completed",
      },
    };
    api.getOnboardingProgress.mockResolvedValue(finalStep);
    api.updateOnboardingProgress.mockResolvedValue({
      ...finalStep,
      status: "complete",
      steps: { ...finalStep.steps, advanced_delivery: "completed" },
      completedAt: 100,
    });

    render(<MemoryRouter><Onboarding /></MemoryRouter>);
    expect(await screen.findByRole("heading", { name: "Optional delivery enhancements" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Mark reviewed" }));

    expect(await screen.findByRole("heading", { name: "Setup checklist complete" })).toBeTruthy();
    expect(screen.getByText("You reviewed every setup option.")).toBeTruthy();
  });

  it("does not show the completion state when the final unresolved item is skipped", async () => {
    const finalStep: OnboardingProgress = {
      ...pending,
      steps: {
        email_calendar: "completed",
        ai: "completed",
        tasks: "completed",
        weather: "completed",
        finances: "completed",
        notifications: "completed",
      },
    };
    api.getOnboardingProgress.mockResolvedValue(finalStep);
    api.updateOnboardingProgress.mockResolvedValue({
      ...finalStep,
      steps: { ...finalStep.steps, advanced_delivery: "skipped" },
    });

    render(<MemoryRouter><Onboarding /></MemoryRouter>);
    expect(await screen.findByRole("heading", { name: "Optional delivery enhancements" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Skip for now" }));

    await waitFor(() => expect(api.updateOnboardingProgress).toHaveBeenCalledWith({
      action: "skip",
      stepId: "advanced_delivery",
    }));
    expect(screen.queryByRole("heading", { name: "Setup checklist complete" })).toBeNull();
    expect(screen.getByRole("heading", { name: "Optional delivery enhancements" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Finish onboarding" })).toBeTruthy();
  });

  it("finishes with every integration still pending and offers explicit reopen", async () => {
    const changed = vi.fn();
    window.addEventListener("ea-onboarding-changed", changed);
    render(<MemoryRouter><Onboarding /></MemoryRouter>);
    await screen.findByRole("heading", { name: "Connect email and calendar" });

    fireEvent.click(screen.getByRole("button", { name: "Finish onboarding" }));
    expect(await screen.findByRole("heading", { name: "Setup checklist complete" })).toBeTruthy();
    expect(changed).toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Reopen checklist" }));
    await waitFor(() => expect(api.updateOnboardingProgress).toHaveBeenCalledWith({ action: "reopen" }));
    window.removeEventListener("ea-onboarding-changed", changed);
  });
});
