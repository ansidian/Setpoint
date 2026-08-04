import type { Page, TestInfo } from "@playwright/test";

interface StoredNote {
  id: string | number;
  content?: string;
}

export function notesTestScope(testInfo: TestInfo): string {
  const id = testInfo.testId.replace(/[^a-zA-Z0-9_-]/g, "-");
  return `e2e-notes-${id}`;
}

export async function cleanupNotesTestData(page: Page, scope: string): Promise<void> {
  const listResponse = await page.request.get("/api/notes");
  if (!listResponse.ok()) {
    throw new Error(`Notes cleanup could not list notes: ${listResponse.status()}`);
  }

  const notes = await listResponse.json() as StoredNote[];
  const ownedNotes = notes.filter((note) => note.content?.includes(scope));
  for (const note of ownedNotes) {
    const deleteResponse = await page.request.delete(`/api/notes/${encodeURIComponent(note.id)}`, {
      headers: { "X-Requested-With": "Setpoint" },
    });
    if (!deleteResponse.ok()) {
      throw new Error(`Notes cleanup could not delete note ${note.id}: ${deleteResponse.status()}`);
    }
  }
}
