import { useState } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BrowserRouter } from "react-router";
import { CONNECTIONS, CONNECTION_GROUPS } from "./connectionModel";
import type { ConnectionRowView, ConnectionState } from "./connectionModel";
import ConnectionsDirectory from "./ConnectionsDirectory";
import type { OnboardingProgress } from "../../../shared/types/onboarding";

const states: Record<string, ConnectionState> = {
  "google-workspace": "connected",
  "icloud-mail": "needs_attention",
  todoist: "needs_setup",
  "actual-budget": "not_connected",
  openai: "connected",
  anthropic: "not_connected",
  "discord-reminders": "not_connected",
  "pirate-weather": "needs_setup",
  "google-places": "not_connected",
};

const rows: ConnectionRowView[] = CONNECTIONS.map((definition) => ({
  ...definition,
  state: states[definition.id]!,
  statusLabel: states[definition.id]!.replace("_", " "),
  source: definition.id === "google-workspace" ? "stored" : null,
  mode: definition.id === "google-workspace" ? "google_oauth" : null,
  identities: [],
  lastTestedAt: null,
  lastSucceededAt: null,
  lastFailedAt: null,
}));

function renderDirectory(onboardingProgress?: OnboardingProgress | null, connectionRows = rows) {
  return render(
    <BrowserRouter>
      <ConnectionsDirectory
        groups={CONNECTION_GROUPS}
        rows={connectionRows}
        onboardingProgress={onboardingProgress}
        renderPanel={(connection) => <div data-testid={`panel-${connection.id}`}>{connection.label} controls</div>}
      />
    </BrowserRouter>,
  );
}

afterEach(cleanup);

beforeEach(() => {
  window.history.replaceState({}, "", "/settings?tab=connections");
});

describe("ConnectionsDirectory", () => {
  it("renders the fixed groups and service order with every row collapsed by default", () => {
    renderDirectory();

    expect(screen.getAllByRole("heading", { level: 2 }).map((heading) => heading.textContent)).toEqual([
      "Data sources",
      "AI providers",
      "Supporting services",
    ]);
    expect(screen.getAllByRole("button").map((button) => button.getAttribute("data-connection-id"))).toEqual(
      CONNECTIONS.map(({ id }) => id),
    );
    for (const button of screen.getAllByRole("button")) {
      expect(button.getAttribute("aria-expanded")).toBe("false");
    }
    expect(screen.queryByTestId(/panel-/)).toBeNull();
    expect(within(screen.getByRole("button", { name: /iCloud Mail/i })).getByText(/needs attention/i)).toBeTruthy();
  });

  it("keeps one inline panel mounted and restores it through browser history", async () => {
    renderDirectory();

    fireEvent.click(screen.getByRole("button", { name: /Todoist/i }));
    expect(window.location.hash).toBe("#todoist");
    expect(screen.getByTestId("panel-todoist")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /OpenAI/i }));
    expect(window.location.hash).toBe("#openai");
    expect(screen.queryByTestId("panel-todoist")).toBeNull();
    expect(screen.getByTestId("panel-openai")).toBeTruthy();

    act(() => window.history.back());
    await waitFor(() => expect(screen.getByTestId("panel-todoist")).toBeTruthy());

    act(() => window.history.forward());
    await waitFor(() => expect(screen.getByTestId("panel-openai")).toBeTruthy());
  });

  it("marks an ordinary drawer expansion as local settings navigation", () => {
    renderDirectory();

    fireEvent.click(screen.getByRole("button", { name: /Todoist/i }));

    expect(window.history.state.usr).toMatchObject({ settingsTargetReveal: "suppress" });
  });

  it("opens a canonical direct hash and closes it without leaving an empty hash", () => {
    window.history.replaceState({}, "", "/settings?tab=connections#actual-budget");
    renderDirectory();

    const trigger = screen.getByRole("button", { name: /Actual Budget/i });
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByTestId("panel-actual-budget")).toBeTruthy();

    fireEvent.click(trigger);
    expect(window.location.hash).toBe("");
    expect(screen.queryByTestId("panel-actual-budget")).toBeNull();
  });

  it("canonicalizes a deterministic legacy tab and card hash", async () => {
    window.history.replaceState({}, "", "/settings?tab=actual#actual-budget-connection");
    renderDirectory();

    expect(await screen.findByTestId("panel-actual-budget")).toBeTruthy();
    await waitFor(() => {
      expect(window.location.search).toBe("?tab=connections");
      expect(window.location.hash).toBe("#actual-budget");
    });
  });

  it("unmounts a closed panel so unsaved credential candidates are discarded", () => {
    function CandidatePanel() {
      const [candidate, setCandidate] = useState("");
      return (
        <input
          aria-label="Credential candidate"
          type="password"
          value={candidate}
          onChange={(event) => setCandidate(event.target.value)}
        />
      );
    }

    render(
      <BrowserRouter>
        <ConnectionsDirectory
          groups={CONNECTION_GROUPS}
          rows={rows}
          renderPanel={() => <CandidatePanel />}
        />
      </BrowserRouter>,
    );
    const trigger = screen.getByRole("button", { name: /Todoist/i });
    fireEvent.click(trigger);
    fireEvent.change(screen.getByLabelText("Credential candidate"), { target: { value: "plaintext" } });
    fireEvent.click(trigger);
    fireEvent.click(trigger);

    expect((screen.getByLabelText("Credential candidate") as HTMLInputElement).value).toBe("");
  });

  it("keeps a return to onboarding available until the checklist is finished", () => {
    const inProgress: OnboardingProgress = {
      version: 1,
      status: "in_progress",
      steps: { ai: "reviewed" },
      completedAt: null,
      updatedAt: 1,
    };
    const { rerender } = renderDirectory(inProgress);

    expect(screen.getByRole("link", { name: "Continue setup" }).getAttribute("href"))
      .toBe("/onboarding?step=ai");

    rerender(
      <BrowserRouter>
        <ConnectionsDirectory
          groups={CONNECTION_GROUPS}
          rows={rows}
          onboardingProgress={{ ...inProgress, steps: { advanced_delivery: "skipped" } }}
          renderPanel={() => null}
        />
      </BrowserRouter>,
    );
    expect(screen.getByRole("link", { name: "Continue setup" }).getAttribute("href"))
      .toBe("/onboarding?step=email_calendar");
  });

  it("does not reopen finished onboarding when a connection later breaks", () => {
    renderDirectory({
      version: 1,
      status: "complete",
      steps: { email_calendar: "reviewed" },
      completedAt: 2,
      updatedAt: 2,
    }, rows.map((row) => row.id === "google-workspace" ? {
      ...row,
      state: "needs_attention",
      statusLabel: "Needs attention",
    } : row));

    expect(screen.queryByRole("link", { name: "Continue setup" })).toBeNull();
  });
});
