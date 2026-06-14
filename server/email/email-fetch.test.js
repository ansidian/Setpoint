import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../platform/encryption.js", () => ({ decrypt: vi.fn() }));
vi.mock("./gmail.js", () => ({ fetchEmails: vi.fn() }));
vi.mock("./icloud.js", () => ({ fetchEmails: vi.fn() }));

const { decrypt } = await import("../platform/encryption.js");
const { fetchEmails: fetchGmailEmails } = await import("./gmail.js");
const { fetchEmails: fetchIcloudEmails } = await import("./icloud.js");
const { fetchAllEmails } = await import("./email-fetch.js");

afterEach(() => {
  vi.clearAllMocks();
});

describe("fetchAllEmails", () => {
  it("degrades a single iCloud decrypt failure without sinking the other accounts (P2-38)", async () => {
    fetchGmailEmails.mockResolvedValue([{ uid: "gmail-1" }]);
    // decrypt throws (corrupt/rotated key) for the iCloud account.
    decrypt.mockImplementation(() => { throw new Error("bad encryption key"); });
    fetchIcloudEmails.mockResolvedValue([{ uid: "icloud-1" }]);

    const result = await fetchAllEmails(
      [
        { type: "gmail", email: "g@example.com" },
        { type: "icloud", email: "i@example.com", credentials_encrypted: "enc" },
      ],
      24,
    );

    // The healthy Gmail results must survive even though iCloud's decrypt threw.
    expect(result).toEqual([{ uid: "gmail-1" }]);
    expect(fetchIcloudEmails).not.toHaveBeenCalled();
  });
});
