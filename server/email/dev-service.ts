import { indexEmails } from "./email-index.ts";
import { loadUserConfig } from "../platform/config-service.ts";
import { fetchAllEmails } from "./email-fetch.ts";
import type { EmailDevReindexResponse } from "../../shared/types/email.ts";

export async function reindexEmails(userId: string, hoursBack: number): Promise<EmailDevReindexResponse> {
  const { accounts } = await loadUserConfig(userId);
  const emails = await fetchAllEmails(accounts, hoursBack);
  await indexEmails(userId, emails);
  return { indexed: emails.length, hoursBack };
}
