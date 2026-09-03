import type { DemoSeed } from "./store.ts";
import { demoEmailAiUsageStats, demoLegacyTriageStats } from "./emailAiUsageData.ts";
import { getDemoTodoistSetupResponse, NO_DEMO_TODOIST_SETUP_RESPONSE } from "./todoistSetupAdapter.ts";

export const NO_DEMO_REFERENCE_RESPONSE = Symbol("NO_DEMO_REFERENCE_RESPONSE");

export function getDemoReferenceResponse({ pathname, method, seed }: { pathname: string; method: string; seed: DemoSeed }): unknown {
  if (pathname === "/api/ea/triage/cache-stats") return demoLegacyTriageStats();
  if (pathname === "/api/ea/email-ai/usage") return structuredClone(demoEmailAiUsageStats());
  const todoistSetupResponse = getDemoTodoistSetupResponse(pathname, method, pathname);
  if (todoistSetupResponse !== NO_DEMO_TODOIST_SETUP_RESPONSE) return todoistSetupResponse;
  if (pathname === "/api/auth/logout" && method === "POST") return { ok: true };
  if (pathname.match(/^\/api\/briefing\/tombstone\/[^/]+$/) && method === "DELETE") return { ok: true };
  if (pathname === "/api/briefing/todoist/projects") {
    return [
      { id: "demo-project-inbox", name: "Inbox", isInbox: true, color: "#89b4fa" },
      { id: "demo-project-engineering", name: "Engineering", isInbox: false, color: "#a6e3a1" },
      { id: "demo-project-career", name: "Career", isInbox: false, color: "#f5c2e7" },
    ];
  }
  if (pathname === "/api/briefing/todoist/labels") {
    return [
      { id: "demo-label-deep-work", name: "deep-work" },
      { id: "demo-label-follow-up", name: "follow-up" },
      { id: "demo-label-quick-win", name: "quick-win" },
    ];
  }
  if (pathname === "/api/ea/schedules/skip" && method === "POST") {
    return { ok: true, schedules: [] };
  }
  if (pathname.match(/^\/api\/alfred\/conversations\/[^/]+$/) && method === "DELETE") return { ok: true };
  if (pathname === "/api/ea/geocode") return [];
  if (pathname === "/api/briefing/actual/accounts") return structuredClone(seed.actualMetadata.accounts);
  if (pathname === "/api/briefing/actual/payees") return structuredClone(seed.actualMetadata.payees);
  if (pathname === "/api/briefing/actual/categories") return structuredClone(seed.actualMetadata.categories);
  return NO_DEMO_REFERENCE_RESPONSE;
}
