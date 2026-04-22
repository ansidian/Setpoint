import fs from "fs/promises";
import path from "path";
import { expect, request as playwrightRequest, test as setup } from "@playwright/test";

const authFile = path.join(process.cwd(), "playwright/.auth/user.json");
const baseURL = "http://127.0.0.1:4173";

setup("authenticate local e2e session", async ({ request }) => {
  const password = process.env.PLAYWRIGHT_EA_PASSWORD;
  if (!password) {
    throw new Error("PLAYWRIGHT_EA_PASSWORD is required for Playwright auth setup.");
  }

  await fs.mkdir(path.dirname(authFile), { recursive: true });

  try {
    await fs.access(authFile);
    const existing = await playwrightRequest.newContext({
      baseURL,
      storageState: authFile,
      extraHTTPHeaders: {
        "X-Requested-With": "EADashboard",
      },
    });
    const check = await existing.get("/api/auth/check");
    const body = await check.json().catch(() => null);
    await existing.dispose();
    if (check.ok() && body?.authenticated === true) {
      return;
    }
  } catch {
    // Fall through to a fresh login when auth state is missing or stale.
  }

  const response = await request.post("/api/auth/login", {
    data: { password },
    headers: {
      "Content-Type": "application/json",
      "X-Requested-With": "EADashboard",
    },
  });

  expect(response.ok()).toBe(true);
  expect(await response.json()).toEqual({ authenticated: true });

  await request.storageState({ path: authFile });
});
