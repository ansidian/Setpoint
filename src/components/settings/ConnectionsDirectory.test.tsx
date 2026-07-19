import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BrowserRouter } from "react-router-dom";
import { CONNECTIONS, CONNECTION_GROUPS } from "./connectionModel";
import type { ConnectionRowView, ConnectionState } from "./connectionModel";
import ConnectionsDirectory from "./ConnectionsDirectory";

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

function renderDirectory() {
  return render(
    <BrowserRouter>
      <ConnectionsDirectory
        groups={CONNECTION_GROUPS}
        rows={rows}
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
});
