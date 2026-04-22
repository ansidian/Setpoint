import { expect, test } from "@playwright/test";
import { installDashboardShellFixtures } from "./support/dashboard-fixtures.js";

test("shows update recency without replacing the AI headline in the desktop shell pill", async ({ page }) => {
  const aiGeneratedAt = new Date(Date.now() - (2 * 60 * 60 * 1000)).toISOString();
  const dataUpdatedAt = new Date(Date.now() - (5 * 60 * 1000)).toISOString();

  await installDashboardShellFixtures(page, {
    briefing: {
      aiGeneratedAt,
      dataUpdatedAt,
      skippedAI: true,
      nonAiGenerationCount: 2,
    },
    settings: {
      schedules: [{ enabled: true, time: "09:00", label: "Morning Briefing" }],
    },
  });

  await page.goto("/");

  const statusPill = page.getByTestId("shell-header-briefing-status");
  await expect(statusPill).toBeVisible();
  await expect(statusPill).toContainText("Quiet refresh");
  await expect(statusPill).toContainText("Updated");
  await expect(statusPill).toContainText("Morning Briefing");
});
