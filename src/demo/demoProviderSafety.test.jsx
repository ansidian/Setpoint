import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RailAction } from "../components/calendar/DetailRailPrimitives.jsx";
import { openInNewTab } from "../components/calendar/views/deadlines/deadlinesModel.js";
import { linkifyText } from "../components/notes/notesUtils.jsx";
import { getGmailUrl } from "../lib/email-links.js";

describe("demo mode provider and external navigation safety", () => {
  afterEach(() => {
    cleanup();
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

    render(<RailAction label="Open in Actual" href="https://actual.example.test/schedules" />);

    expect(screen.queryByRole("link", { name: /open in actual/i })).toBeNull();
    expect(screen.getByRole("button", { name: /open in actual disabled in demo mode/i }).disabled).toBe(true);
  });

  it("blocks imperative and note-link external navigation in demo mode", () => {
    vi.stubEnv("VITE_EA_DEMO", "1");
    const open = vi.fn();
    vi.stubGlobal("open", open);

    openInNewTab("https://provider.example.test");
    const { container } = render(<div>{linkifyText("Read https://docs.example.test", "#89b4fa")}</div>);

    expect(open).not.toHaveBeenCalled();
    expect(screen.queryByRole("link")).toBeNull();
    expect(container.textContent).toBe("Read https://docs.example.test");
  });
});
