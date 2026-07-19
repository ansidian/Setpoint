import { afterEach, describe, expect, it, vi } from "vitest";
import type * as ApiModule from "../api";

type ApiExportName = keyof typeof ApiModule;

const NON_REQUEST_NAMES = [
  "peekEmailBody",
  "prefetchCurrentDashboard",
  "runAlfredStream",
  "settleArrivalGraceOnExit",
  "trashEmailOnExit",
] as const satisfies readonly ApiExportName[];
const NON_REQUEST = new Set<string>(NON_REQUEST_NAMES);

// These surfaces are deliberately unavailable in the public walkthrough.
const INTENTIONALLY_UNHANDLED_NAMES = [
  "cancelPasskeyAuthentication",
  "addICloudAccount",
  "createApiToken",
  "disableInstanceCredential",
  "deletePasskeyCredential",
  "disconnectTodoistConnection",
  "extractBillFromEmail",
  "getGmailAuthUrl",
  "getPasskeyAuthenticationOptions",
  "getPasskeyRegistrationOptions",
  "hydrateActualBudgetCache",
  "importInstanceCredentialEnvironment",
  "listApiTokens",
  "listPasskeys",
  "removeAccount",
  "removeActualBudgetConnection",
  "reorderAccounts",
  "resolveBillPayMappingSample",
  "resolveBillPaySeed",
  "revokeApiToken",
  "sendToActualBudget",
  "saveActualBudgetConnection",
  "saveTodoistPersonalToken",
  "settleArrivalGrace",
  "stageGoogleOAuthApplication",
  "stageInstanceCredential",
  "testActualBudget",
  "testDiscordReminderWebhook",
  "testInstanceCredential",
  "updateAccount",
  "verifyPasskeyAuthentication",
  "verifyPasskeyRegistration",
  "useHostInstanceCredential",
] as const satisfies readonly ApiExportName[];
const INTENTIONALLY_UNHANDLED = new Set<string>(INTENTIONALLY_UNHANDLED_NAMES);

const ARGS: Partial<Record<ApiExportName, unknown[]>> = {
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
      const exportName = name as ApiExportName;

      try {
        await (request as (...args: unknown[]) => unknown)(...(ARGS[exportName] || ["demo-id", {}]));
      } catch (error) {
        if (error && typeof error === "object" && "code" in error && error.code === "DEMO_API_UNHANDLED") {
          unhandled.push(`${name}: ${"message" in error ? String(error.message) : "unhandled"}`);
        }
      }
    }

    expect(unhandled, `Unhandled demo API exports:\n${unhandled.join("\n")}`).toEqual([]);
  });
});
