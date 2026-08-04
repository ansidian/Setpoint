import { afterEach, describe, expect, it, vi } from "vitest";

// test-architecture: allow-boundary-mock -- Credential decryption is the cryptographic boundary whose isolated failure must not sink healthy provider results.
vi.mock("../platform/encryption.ts", () => ({ decrypt: vi.fn() }));
// test-architecture: allow-boundary-mock -- Gmail fetch is an outbound provider boundary; the facade test supplies its normalized successful result.
vi.mock("./gmail.ts", () => ({ fetchEmails: vi.fn() }));
// test-architecture: allow-boundary-mock -- iCloud IMAP fetch is an outbound provider boundary; the facade test proves it is never entered after decryption fails.
vi.mock("./icloud.ts", () => ({ fetchEmails: vi.fn() }));

const { decrypt } = await import("../platform/encryption.ts");
const { fetchEmails: fetchGmailEmails } = await import("./gmail.ts");
const { fetchEmails: fetchIcloudEmails } = await import("./icloud.ts");
const { fetchAllEmails } = await import("./email-fetch.ts");
const decryptMock = vi.mocked(decrypt);
const fetchGmailEmailsMock = vi.mocked(fetchGmailEmails);
const fetchIcloudEmailsMock = vi.mocked(fetchIcloudEmails);

afterEach(() => {
  vi.clearAllMocks();
});

describe("fetchAllEmails", () => {
  it("degrades a single iCloud decrypt failure without sinking the other accounts (P2-38)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    fetchGmailEmailsMock.mockResolvedValue([{ uid: "gmail-1" }] as never);
    // decrypt throws (corrupt/rotated key) for the iCloud account.
    decryptMock.mockImplementation(() => { throw new Error("bad encryption key"); });
    fetchIcloudEmailsMock.mockResolvedValue([{ uid: "icloud-1" }] as never);

    const result = await fetchAllEmails(
      [
        { type: "gmail", email: "g@example.com" },
        { type: "icloud", email: "i@example.com", credentials_encrypted: "enc" },
      ],
      24,
    );

    // The healthy Gmail results must survive even though iCloud's decrypt threw.
    expect(result).toEqual([{ uid: "gmail-1" }]);
    // test-architecture: allow-boundary-interaction -- iCloud IMAP is the outbound provider boundary; a credential-decryption failure must prevent any password-bearing connection attempt.
    expect(fetchIcloudEmailsMock).not.toHaveBeenCalled();
  });
});
