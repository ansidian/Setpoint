// Which keypresses inside the email-body iframe get re-dispatched to the parent
// document so the inbox/shell/Alfred listeners (which live on the parent and never
// see iframe keydowns) can act on them. Pure so the rule is testable without a
// live iframe. EmailIframe.tsx owns the actual relay wiring.
//
// The set is the union of single-key parent commands the reader should not swallow:
//   1 2            shell tab switch (useDashboardShellHotkeys)
//   h d f n a s e  inbox triage/lane/trash (useInboxKeyboardCommands)
//   j k            inbox next/prev
//   o              open-in-Gmail
//   escape         Alfred preview close (AlfredPanel capture listener)
// Stored lowercased; membership is tested case-insensitively. Deliberately excludes
// arrows/space/page keys and modifier combos except Alfred's global Cmd/Ctrl+\
// toggle, so native scroll, copy, and find keep working inside the email.
export const READER_RELAY_KEYS = new Set([
  "1", "2",
  "h", "d", "f", "n", "a", "s", "e",
  "j", "k", "o",
  "escape",
]);

const EDITABLE_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT"]);

export interface ReaderKeyDescriptor {
  key?: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  targetTag?: string;
  isContentEditable?: boolean;
}

export function shouldRelayReaderKey({
  key,
  metaKey = false,
  ctrlKey = false,
  altKey = false,
  targetTag = "",
  isContentEditable = false,
}: ReaderKeyDescriptor = {}): boolean {
  if ((metaKey || ctrlKey) && !altKey && key === "\\") return true;
  if (metaKey || ctrlKey || altKey) return false;
  if (isContentEditable) return false;
  if (EDITABLE_TAGS.has(String(targetTag).toUpperCase())) return false;
  if (typeof key !== "string") return false;
  return READER_RELAY_KEYS.has(key.toLowerCase());
}
