import { expect, test } from "@playwright/test";

test.use({ storageState: { cookies: [], origins: [] } });

test("redirects unauthenticated users to the login screen", async ({ page }) => {
  await page.goto("/");

  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("textbox", { name: "Password" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign in" })).toBeDisabled();
});
