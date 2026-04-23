import { expect, test } from "@playwright/test";
import { installDashboardShellFixtures } from "./support/dashboard-fixtures.js";

test("shows a compact temporary update badge without replacing the AI headline", async ({ page }) => {
  const aiGeneratedAt = new Date(Date.now() - (2 * 60 * 60 * 1000)).toISOString();
  const dataUpdatedAt = new Date().toISOString();

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
  await expect(statusPill).toContainText("Quiet x2");
  await expect(statusPill).toContainText("Updated");
  await expect(statusPill).not.toContainText(/Updated .*ago/);
  await expect(statusPill).toContainText("Next 9:00 AM");
  await expect(statusPill).toHaveAttribute("title", /Morning Briefing/);
});
