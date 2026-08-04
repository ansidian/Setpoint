import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { cleanupNotesTestData, notesTestScope } from "./support/notes-fixtures.ts";

test.beforeEach(async ({ page }, testInfo) => {
  await cleanupNotesTestData(page, notesTestScope(testInfo));
});

test.afterEach(async ({ page }, testInfo) => {
  await cleanupNotesTestData(page, notesTestScope(testInfo));
});

async function openNotes(page: Page) {
  await page.goto("/");
  const notesTab = page.getByRole("tab", { name: "Notes" });
  await expect(notesTab).toBeVisible();
  await notesTab.click();
}

test("note capture: live markdown + #tag autocomplete", async ({ page }, testInfo) => {
  const scope = notesTestScope(testInfo);
  const seedBody = `${scope}: seed tag`;
  const submittedBody = `${scope}: ship the thing`;

  await openNotes(page);
  const editor = page.getByRole("textbox", { name: "New note" });
  await editor.click();
  await editor.pressSequentially(`${scope}: seed #home tag`); // ensure a #home tag exists
  await editor.press("Enter");
  await expect(page.getByText(seedBody, { exact: true })).toBeVisible(); // tag is now in the tag set
  await editor.click();
  await editor.pressSequentially(`${scope}: ship the thing #ho`); // per-keystroke events drive autocomplete
  const autocomplete = page.getByRole("listbox");
  await expect(autocomplete).toBeVisible();
  const homeOption = autocomplete.getByRole("option", { name: "#home" });
  await expect(homeOption).toBeVisible();
  await homeOption.click();                               // accept #home (does NOT submit)
  await expect(editor).toContainText("#home");
  await editor.press("Enter");                           // now submit the note
  await expect(page.getByText(submittedBody, { exact: true })).toBeVisible();
});

test("note list: checkbox toggle persists after save (read-view path)", async ({ page }, testInfo) => {
  const scope = notesTestScope(testInfo);
  const checkboxContent = `- [ ] ${scope} buy milk`;

  await openNotes(page);
  const editor = page.getByRole("textbox", { name: "New note" });
  await editor.click();
  await editor.pressSequentially(checkboxContent);
  await editor.press("Enter");                           // continue the checkbox list
  await editor.press("Enter");                           // exit the empty checkbox item
  await editor.press("Enter");                           // submit after exiting the list
  // renderNoteMarkdown renders a native checkbox in the saved note row (not the
  // in-editor widget). Clicking it toggles via toggleCheckboxLine and persists.
  const box = page.getByRole("checkbox", { name: /buy milk/i });
  await box.click();
  await expect(box).toBeChecked();

  await page.reload();
  const notesTab = page.getByRole("tab", { name: "Notes" });
  await expect(notesTab).toBeVisible();
  await notesTab.click();
  await expect(page.getByRole("checkbox", { name: /buy milk/i })).toBeChecked();

  await expect.poll(async () => {
    const response = await page.request.get("/api/notes");
    if (!response.ok()) return false;
    const notes = await response.json() as Array<{ content?: string }>;
    return notes.some((note) => note.content?.includes(`- [x] ${scope} buy milk`));
  }).toBe(true);
});
