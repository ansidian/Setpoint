import { describe, expect, it } from "vitest";
import {
  connectionIdFromHash,
  connectionSummary,
} from "./connectionDirectoryModel";

describe("connection directory routing", () => {
  it.each([
    ["#todoist", "todoist"],
    ["todoist", "todoist"],
    ["#todoist-setup", "todoist"],
    ["#actual-budget-connection", "actual-budget"],
    ["#discord-reminders", "discord-reminders"],
    ["#gmail-realtime-delivery", "google-workspace"],
    ["#connected-accounts", null],
    ["#ai-provider-credentials", null],
    ["#location-provider-credentials", null],
    ["#unknown", null],
    ["", null],
  ] as const)("resolves %s to %s", (hash, expected) => {
    expect(connectionIdFromHash(hash)).toBe(expected);
  });

  it("summarizes operational states without counting optional disconnected services", () => {
    expect(connectionSummary([
      { state: "connected" },
      { state: "connected" },
      { state: "needs_setup" },
      { state: "needs_attention" },
      { state: "not_connected" },
      { state: null },
    ])).toEqual({ connected: 2, setup: 1, attention: 1 });
  });
});
