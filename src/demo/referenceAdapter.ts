import { demoTodoistProjects } from "./taskFields";
import { demoEmailAiUsageStats, demoLegacyTriageStats } from "./emailAiUsageData.ts";
import { getDemoTodoistSetupResponse, NO_DEMO_TODOIST_SETUP_RESPONSE } from "./todoistSetupAdapter.ts";

export const NO_DEMO_REFERENCE_RESPONSE = Symbol("NO_DEMO_REFERENCE_RESPONSE");

export function getDemoReferenceResponse({ pathname, method }: { pathname: string; method: string }): unknown {
  if (pathname === "/api/ea/triage/cache-stats") return demoLegacyTriageStats();
  if (pathname === "/api/ea/email-ai/usage") return structuredClone(demoEmailAiUsageStats());
  const todoistSetupResponse = getDemoTodoistSetupResponse(pathname, method, pathname);
  if (todoistSetupResponse !== NO_DEMO_TODOIST_SETUP_RESPONSE) return todoistSetupResponse;
  if (pathname === "/api/auth/logout" && method === "POST") return { ok: true };
  if (pathname.match(/^\/api\/briefing\/tombstone\/[^/]+$/) && method === "DELETE") return { ok: true };
  if (pathname === "/api/briefing/todoist/projects") {
    return structuredClone(demoTodoistProjects);
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
  return NO_DEMO_REFERENCE_RESPONSE;
}
