import { expect, test } from "@playwright/test";
import { installDashboardInboxFixtures } from "./support/dashboard-fixtures.js";

async function openInbox(page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Inbox" }).click();
  await expect(page.getByTestId("inbox-mobile-list")).toBeVisible();
}

test("preserves mobile inbox search when opening and closing a reader", async ({ page }) => {
  const { actionSubject } = await installDashboardInboxFixtures(page);

  await openInbox(page);

  await expect(page.getByText("Inbox snapshot", { exact: true })).toBeVisible();
  await expect(page.getByTestId("inbox-desktop-view")).toHaveCount(0);
  await expect(page.getByTestId("inbox-mobile-chip-grid")).toBeVisible();

  await page.getByLabel("Search inbox").fill("Project");
  await page.getByText(actionSubject, { exact: true }).click();

  await expect(page.getByTestId("inbox-mobile-reader")).toBeVisible();
  await expect(page.getByTestId("inbox-mobile-reader-body")).toBeVisible();

  await page.getByLabel("Back to inbox").click();
  await expect(page.getByTestId("inbox-mobile-list")).toBeVisible();
  await expect(page.getByLabel("Search inbox")).toHaveValue("Project");
});

test("filters the mobile inbox and opens reader action workspaces", async ({ page }) => {
  const { actionSubject, personalSubject, liveSubject } = await installDashboardInboxFixtures(page);

  await openInbox(page);

  await page.getByTestId("inbox-mobile-filter-trigger").click();
  await expect(page.getByTestId("inbox-mobile-filter-sheet")).toBeVisible();

  await page.mouse.click(20, 20);
  await expect(page.getByTestId("inbox-mobile-filter-sheet")).toHaveCount(0);

  await page.getByTestId("inbox-mobile-filter-trigger").click();
  const filterSheet = page.getByTestId("inbox-mobile-filter-sheet");
  await filterSheet.getByRole("button", { name: /Work/i }).click();

  await expect(page.getByTestId("inbox-mobile-filter-sheet")).toHaveCount(0);
  await expect(page.getByText(actionSubject, { exact: true })).toBeVisible();
  await expect(page.getByText(personalSubject, { exact: true })).toHaveCount(0);

  const chipGrid = page.getByTestId("inbox-mobile-chip-grid");
  await chipGrid.getByRole("button", { name: /^New/ }).click();
  await expect(page.getByText(liveSubject, { exact: true })).toBeVisible();
  await expect(page.getByText(actionSubject, { exact: true })).toHaveCount(0);

  await chipGrid.getByRole("button", { name: /^Action/ }).click();
  await expect(page.getByText(actionSubject, { exact: true })).toBeVisible();
  await expect(page.getByText(liveSubject, { exact: true })).toHaveCount(0);

  await page.getByText(actionSubject, { exact: true }).click();
  const reader = page.getByTestId("inbox-mobile-reader");
  await expect(reader).toBeVisible();

  await reader.getByRole("button", { name: /^Actions$/ }).click();
  await page.getByRole("button", { name: /Open bill pay/i }).click();
  await expect(page.getByTestId("inbox-mobile-bill-panel")).toBeVisible();

  await reader.getByRole("button", { name: /^Actions$/ }).click();
  await page.getByRole("button", { name: /Show draft reply/i }).click();
  await expect(page.getByTestId("inbox-mobile-draft-panel")).toBeVisible();
});

test("returns from the mobile reader to the inbox list on browser back", async ({ page }) => {
  const { actionSubject } = await installDashboardInboxFixtures(page);

  await openInbox(page);
  await page.getByText(actionSubject, { exact: true }).click();

  await expect(page.getByTestId("inbox-mobile-reader")).toBeVisible();
  await page.goBack();

  await expect(page.getByTestId("inbox-mobile-list")).toBeVisible();
  await expect(page.getByTestId("inbox-mobile-reader")).toHaveCount(0);
});
