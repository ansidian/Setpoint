import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

async function importDemoSettingsPage() {
  vi.resetModules();
  vi.stubEnv("VITE_EA_DEMO", "1");
  vi.stubGlobal("fetch", vi.fn());
  return import("./Settings");
}

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("Settings demo mode", () => {
  // The dynamic Settings import chain is slow under full-suite worker load;
  // the default 10s test timeout flakes even though the test passes in ~4s alone.
  it("maps the legacy Briefing URL to Automation with demo data and no real fetch", async () => {
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
  }, 30000);
});
