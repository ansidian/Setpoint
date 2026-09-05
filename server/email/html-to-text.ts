import { emailEvidenceText } from "./email-evidence.ts";

// Shared HTML projection for indexed evidence and read-only tool results.
// Reader display sanitization remains separate in EmailReader via DOMPurify.
export function htmlToPlainText(input: unknown): string {
  return emailEvidenceText(input, "html");
}
