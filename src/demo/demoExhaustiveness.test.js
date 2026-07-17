import { afterEach, describe, expect, it, vi } from "vitest";

const NON_REQUEST = new Set([
  "peekEmailBody",
  "prefetchCurrentDashboard",
  "runAlfredStream",
  "settleArrivalGraceOnExit",
  "trashEmailOnExit",
]);

// These surfaces are deliberately unavailable in the public walkthrough.
const INTENTIONALLY_UNHANDLED = new Set([
  "cancelPasskeyAuthentication",
  "addICloudAccount",
  "createApiToken",
  "deletePasskeyCredential",
  "extractBillFromEmail",
  "getGmailAuthUrl",
  "getPasskeyAuthenticationOptions",
  "getPasskeyRegistrationOptions",
  "hydrateActualBudgetCache",
  "listApiTokens",
  "listPasskeys",
  "removeAccount",
  "reorderAccounts",
  "resolveBillPayMappingSample",
  "resolveBillPaySeed",
  "revokeApiToken",
  "sendToActualBudget",
  "settleArrivalGrace",
  "testActualBudget",
  "testDiscordReminderWebhook",
  "updateAccount",
  "verifyPasskeyAuthentication",
  "verifyPasskeyRegistration",
]);

const ARGS = {
  addICloudAccount: ["demo@example.invalid", "demo-password"],
  archiveNote: ["demo-id", true],
  completeDeadlineOccurrence: ["demo-id", "2026-05-12"],
  createApiToken: ["Demo token", ["read"]],
  createCalendarEventsBatch: [[]],
  createReminder: [{}],
  extractBillFromEmail: [{ subject: "Demo", from: "demo@example.invalid", body: "Demo body" }],
  getCalendarBillsRange: ["2026-05-01", "2026-05-31"],
  getCalendarDeadlinesRange: ["2026-05-01", "2026-05-31"],
  getCalendarRange: ["2026-05-01", "2026-05-31"],
  listReminders: [{}],
  markAllEmailsAsRead: [["demo-email-budget"]],
  reorderAccounts: [[]],
  reorderNewsTopics: [[]],
  reorderNotes: [[]],
  searchEmails: ["demo", 10],
  snoozeEmail: ["demo-id", "2026-05-13T15:30:00.000Z"],
  updateAccount: ["demo-id", {}],
  updateCalendarEvent: ["demo-id", {}],
  updateDeadline: ["demo-id", {}],
  updateImportantSenders: [[]],
  updateNewsSource: ["demo-id", {}],
  updateNewsTopicMutedTerms: ["demo-id", []],
  updateNote: ["demo-id", "Demo note"],
  updateSettings: [{}],
  updateTodoistTask: ["demo-id", {}],
};

async function importApiWithDemoMode() {
  vi.resetModules();
  vi.stubEnv("VITE_EA_DEMO", "1");
  vi.stubGlobal("fetch", vi.fn());
  return import("../api");
}

describe("demo API exhaustiveness", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("gives every request export explicit demo behavior", async () => {
    const api = await importApiWithDemoMode();
    const unhandled = [];

    for (const [name, request] of Object.entries(api)) {
      if (typeof request !== "function" || NON_REQUEST.has(name) || INTENTIONALLY_UNHANDLED.has(name)) continue;

      try {
        await request(...(ARGS[name] || ["demo-id", {}]));
      } catch (error) {
        if (error?.code === "DEMO_API_UNHANDLED") {
          unhandled.push(`${name}: ${error.message}`);
        }
      }
    }

    expect(unhandled, `Unhandled demo API exports:\n${unhandled.join("\n")}`).toEqual([]);
  });
});
