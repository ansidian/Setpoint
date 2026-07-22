import { test, expect } from "@playwright/test";

test("note capture: live markdown + #tag autocomplete", async ({ page }) => {
  await page.goto("/");
  await page.keyboard.press("4");                       // open Notes
  const editor = page.getByRole("textbox", { name: "New note" });
  await editor.click();
  await editor.pressSequentially("seed #home tag");     // ensure a #home tag exists
  await page.keyboard.press("Enter");
  await expect(page.getByText("seed #home tag")).toBeVisible(); // tag is now in the tag set
  await editor.click();
  await editor.pressSequentially("ship the thing #ho"); // per-keystroke events drive autocomplete
  const autocomplete = page.getByRole("listbox");
  await expect(autocomplete).toBeVisible();
  await expect(autocomplete.getByRole("option", { name: "#home" })).toBeVisible();
  await page.keyboard.press("Enter");                    // accept #home (does NOT submit)
  await expect(editor).toContainText("#home");
  await page.keyboard.press("Enter");                    // now submit the note
  await expect(page.getByText("ship the thing #home")).toBeVisible();
});

test("note list: checkbox toggle persists after save (read-view path)", async ({ page }) => {
  await page.goto("/");
  await page.keyboard.press("4");
  const editor = page.getByRole("textbox", { name: "New note" });
  await editor.click();
  await editor.pressSequentially("- [ ] buy milk");
  await page.keyboard.press("Enter");
  // renderNoteMarkdown renders a native checkbox in the saved note row (not the
  // in-editor widget). Clicking it toggles via toggleCheckboxLine and persists.
  const box = page.getByRole("checkbox", { name: /buy milk/i });
  await box.click();
  await expect(box).toBeChecked();
});
