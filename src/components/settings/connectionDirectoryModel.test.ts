import { describe, expect, it } from "vitest";
import {
  connectionIdFromHash,
  connectionSetupTargetFromSearch
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

  it.each([
    ["?tab=connections&setup=gmail-realtime", "gmail-realtime"],
    ["?setup=todoist-advanced", "todoist-advanced"],
    ["?setup=google-places", null],
    ["?setup=unknown", null],
    ["", null],
  ] as const)("allowlists advanced setup target %s", (search, expected) => {
    expect(connectionSetupTargetFromSearch(search)).toBe(expected);
  });
});
