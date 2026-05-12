import { isDemoMode } from "../demo/config.js";

// Build a Gmail web URL from an email object's uid + account fields.
// Returns null for non-Gmail or malformed uids. authuser={email} routes to
// the correct Gmail account regardless of /u/N position.
export function getGmailUrl(email) {
  if (isDemoMode()) return null;
  if (!email?.uid || !email?.account_id) return null;
  const prefix = `gmail-${email.account_id}-`;
  if (!email.uid.startsWith(prefix)) return null;
  const messageId = email.uid.slice(prefix.length);
  if (!messageId) return null;
  const authuser = email.account_email ? encodeURIComponent(email.account_email) : 0;
  return `https://mail.google.com/mail/?authuser=${authuser}#all/${messageId}`;
}
