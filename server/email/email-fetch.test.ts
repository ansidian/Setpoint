import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../platform/encryption.ts", () => ({ decrypt: vi.fn() }));
vi.mock("./gmail.ts", () => ({ fetchEmails: vi.fn() }));
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
    expect(fetchIcloudEmailsMock).not.toHaveBeenCalled();
  });
});
