import { indexEmails } from "./email-index.js";
import { loadUserConfig } from "../platform/config-service.js";
import { fetchAllEmails } from "./email-fetch.js";

export async function reindexEmails(userId, hoursBack) {
  const { accounts } = await loadUserConfig(userId);
  const emails = await fetchAllEmails(accounts, hoursBack);
  await indexEmails(userId, emails);
  return { indexed: emails.length, hoursBack };
}
