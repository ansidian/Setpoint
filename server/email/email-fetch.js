import { decrypt } from "../platform/encryption.js";
import { fetchEmails as fetchGmailEmails } from "./gmail.js";
import { fetchEmails as fetchIcloudEmails } from "./icloud.js";

export async function fetchAllEmails(accounts, hoursBack) {
  const gmailAccounts = accounts.filter((a) => a.type === "gmail");
  const icloudAccounts = accounts.filter((a) => a.type === "icloud");

  const emailPromises = [
    ...gmailAccounts.map((account) =>
      fetchGmailEmails(account, hoursBack).catch((err) => {
        console.error(`Gmail fetch failed for ${account.email}:`, err.message);
        return [];
      }),
    ),
    ...icloudAccounts.map(async (account) => {
      // decrypt() must be inside the try too — a corrupt/rotated key throwing here
      // would otherwise reject the whole Promise.all and sink healthy Gmail results.
      try {
        const password = decrypt(account.credentials_encrypted);
        return await fetchIcloudEmails(account, password, hoursBack);
      } catch (err) {
        console.error(`iCloud fetch failed for ${account.email}:`, err.message);
        return [];
      }
    }),
  ];

  const emailArrays = await Promise.all(emailPromises);
  return emailArrays.flat();
}
