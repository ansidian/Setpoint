import { decrypt } from "../platform/encryption.ts";
import { accountCredentialContext } from "../platform/credential-encryption-context.ts";
import { fetchEmails as fetchGmailEmails } from "./gmail.ts";
import { fetchEmails as fetchIcloudEmails } from "./icloud.ts";
import type { NormalizedFetchedEmail } from "../../shared/types/email.ts";
import type { ConfiguredEmailAccount } from "./email-provider-types.ts";
import { emailErrorMessage } from "./email-provider-types.ts";

export async function fetchAllEmails(
  accounts: readonly Record<string, unknown>[],
  hoursBack: number,
): Promise<NormalizedFetchedEmail[]> {
  const gmailAccounts = accounts.filter((account) => account.type === "gmail") as ConfiguredEmailAccount[];
  const icloudAccounts = accounts.filter((account) => account.type === "icloud") as ConfiguredEmailAccount[];

  const emailPromises = [
    ...gmailAccounts.map((account) =>
      fetchGmailEmails(account, hoursBack).catch((err) => {
        console.error(`Gmail fetch failed for ${account.email}:`, emailErrorMessage(err));
        return [];
      }),
    ),
    ...icloudAccounts.map(async (account) => {
      // decrypt() must be inside the try too — a corrupt/rotated key throwing here
      // would otherwise reject the whole Promise.all and sink healthy Gmail results.
      try {
        const password = decrypt(
          account.credentials_encrypted,
          accountCredentialContext(account.id),
        );
        return await fetchIcloudEmails(account, password, hoursBack);
      } catch (err) {
        console.error(`iCloud fetch failed for ${account.email}:`, emailErrorMessage(err));
        return [];
      }
    }),
  ];

  const emailArrays = await Promise.all(emailPromises);
  return emailArrays.flat();
}
