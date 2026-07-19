import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RailAction } from "../components/calendar/DetailRailPrimitives.tsx";
import { openInNewTab } from "../components/calendar/views/deadlines/deadlinesModel.ts";
import { getGmailUrl } from "../lib/email-links";
import { readDemoSafeLocalStorage, writeDemoSafeLocalStorage } from "./demoSafeLocalStorage.ts";

describe("demo mode provider and external navigation safety", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("hides Gmail URLs in demo mode", () => {
    vi.stubEnv("VITE_EA_DEMO", "1");

    expect(getGmailUrl({
      uid: "gmail-work-message-1",
      account_id: "work",
      account_email: "work@example.com",
    })).toBe(null);
  });

  it("turns rail href actions into disabled in-app controls in demo mode", () => {
    vi.stubEnv("VITE_EA_DEMO", "1");

    render(<RailAction label="Open in Actual" href="https://actual.example.test/schedules" icon={() => null} onClick={() => {}} />);

    expect(screen.queryByRole("link", { name: /open in actual/i })).toBeNull();
    expect(screen.getByRole<HTMLButtonElement>("button", { name: /open in actual disabled in demo mode/i }).disabled).toBe(true);
  });

  it("blocks imperative external navigation in demo mode", () => {
    vi.stubEnv("VITE_EA_DEMO", "1");
    const open = vi.fn();
    vi.stubGlobal("open", open);

    openInNewTab("https://provider.example.test");

    expect(open).not.toHaveBeenCalled();
  });

  it("suppresses UI preference storage reads and writes in demo mode", () => {
    vi.stubEnv("VITE_EA_DEMO", "1");
    const getItem = vi.spyOn(Storage.prototype, "getItem");
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const keys = ["ea:tab", "ea:inboxSidebarCompact", "calendar:lastView", "alfred:model"];

    for (const key of keys) {
      expect(readDemoSafeLocalStorage(key)).toBe(null);
      writeDemoSafeLocalStorage(key, "demo-value");
    }

    expect(getItem).not.toHaveBeenCalled();
    expect(setItem).not.toHaveBeenCalled();
  });
});
