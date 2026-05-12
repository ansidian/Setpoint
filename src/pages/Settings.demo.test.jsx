import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

async function importDemoSettingsPage() {
  vi.resetModules();
  vi.stubEnv("VITE_EA_DEMO", "1");
  vi.stubGlobal("fetch", vi.fn());
  return import("./Settings.jsx");
}

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("Settings demo mode", () => {
  it("renders the Email Automation tab with demo data and no real fetch", async () => {
    const { default: Settings } = await importDemoSettingsPage();

    render(
      <MemoryRouter initialEntries={["/settings?tab=briefing"]}>
        <Settings />
      </MemoryRouter>,
    );

    expect(await screen.findByText("Email Triage Automation")).toBeTruthy();
    expect(await screen.findByText("Morgan Lee")).toBeTruthy();
    expect(screen.getByText("morgan@northstar.example")).toBeTruthy();
    expect(screen.getAllByText("Demo-only model")).toHaveLength(2);
    expect(screen.queryByText(/key configured/i)).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
});
