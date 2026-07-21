import { createDemoApiError } from "./config.ts";

export const NO_DEMO_TODOIST_SETUP_RESPONSE = Symbol("NO_DEMO_TODOIST_SETUP_RESPONSE");

export function getDemoTodoistSetupResponse(pathname: string, method: string, path: string): unknown {
  if (pathname === "/api/ea/accounts/todoist/status" && method === "GET") {
    return {
      mode: "disconnected",
      configured: false,
      oauthRefreshable: false,
      needsReauth: false,
      application: { configured: false, source: "absent", pendingConfigured: false },
      callbackUrl: "",
      webhookUrl: "",
      deliveryMode: "periodic",
    };
  }
  if (pathname === "/api/ea/accounts/todoist/auth"
    || pathname.startsWith("/api/instance-credentials/todoist-oauth/")) {
    throw createDemoApiError(path);
  }
  return NO_DEMO_TODOIST_SETUP_RESPONSE;
}
