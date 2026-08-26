import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

type MockFunction = ReturnType<typeof vi.fn>;

interface TestImapClient {
  getMailboxLock: MockFunction;
  search: MockFunction;
  fetch: MockFunction;
  fetchOne?: MockFunction;
  connectDeferred: { resolve: () => void };
}

let activeClient: TestImapClient | null = null;

const QP_SOURCE = Buffer.from([
  "From: SoFi <no-reply@sofi.com>",
  "Subject: Your statement",
  "MIME-Version: 1.0",
  "Content-Type: text/plain; charset=utf-8",
  "Content-Transfer-Encoding: quoted-printable",
  "",
  "Statement bal=",
  "ance $238.80 =E2=80=94 due 07/07/2026",
].join("\r\n"));

const B64_HTML = Buffer.from(
  "<html><body><p>Minimum payment due $29.00</p></body></html>",
).toString("base64");
const MULTIPART_SOURCE = Buffer.from([
  "From: Synchrony <ppv@mail.synchronybank.com>",
  "Subject: Statement ready",
  "MIME-Version: 1.0",
  'Content-Type: multipart/alternative; boundary="XYZBOUNDARY"',
  "",
  "--XYZBOUNDARY",
  "Content-Type: text/html; charset=utf-8",
  "Content-Transfer-Encoding: base64",
  "",
  B64_HTML,
  "--XYZBOUNDARY--",
].join("\r\n"));

class FakeImapFlow {
  usable: boolean;
  connect: MockFunction;
  on: MockFunction;
  getMailboxLock: MockFunction;
  search: MockFunction;
  fetch: MockFunction;

  constructor() {
    this.usable = true;
    this.connect = vi.fn(async () => {});
    this.on = vi.fn();
    this.getMailboxLock = vi.fn(async () => ({ release: vi.fn() }));
    this.search = vi.fn(async () => [11, 12]);
    this.fetch = vi.fn(async function* () {
      yield {
        uid: 11,
        envelope: {
          date: new Date("2026-05-01T15:00:00Z"),
          from: [{ name: "Sender", address: "sender@example.com" }],
          subject: "iCloud range message",
          messageId: "<msg-11@icloud.com>",
        },
        flags: new Set(["\\Seen"]),
        source: Buffer.from("Header: value\r\n\r\nFull iCloud body $45.67"),
      };
      yield {
        uid: 12,
        envelope: {
          date: new Date("2026-05-03T15:00:00Z"),
          from: [{ address: "late@example.com" }],
          subject: "Outside range",
        },
        flags: new Set(),
        source: Buffer.from("Header: value\r\n\r\nOutside"),
      };
    });
    activeClient = this as unknown as TestImapClient;
  }
}

class FakeImapFlowMime {
  usable: boolean;
  connect: MockFunction;
  on: MockFunction;
  getMailboxLock: MockFunction;
  search: MockFunction;
  fetch: MockFunction;

  constructor() {
    this.usable = true;
    this.connect = vi.fn(async () => {});
    this.on = vi.fn();
    this.getMailboxLock = vi.fn(async () => ({ release: vi.fn() }));
    this.search = vi.fn(async () => [21, 22]);
    this.fetch = vi.fn(async function* () {
      yield {
        uid: 21,
        envelope: {
          date: new Date("2026-05-01T15:00:00Z"),
          from: [{ name: "SoFi", address: "no-reply@sofi.com" }],
          subject: "Your statement",
        },
        flags: new Set(),
        source: QP_SOURCE,
      };
      yield {
        uid: 22,
        envelope: {
          date: new Date("2026-05-01T16:00:00Z"),
          from: [{ name: "Synchrony", address: "ppv@mail.synchronybank.com" }],
          subject: "Statement ready",
        },
        flags: new Set(),
        source: MULTIPART_SOURCE,
      };
    });
    activeClient = this as unknown as TestImapClient;
  }
}

class FakeImapFlowAttachment {
  usable: boolean;
  connect: MockFunction;
  on: MockFunction;
  getMailboxLock: MockFunction;
  search: MockFunction;
  fetch: MockFunction;
  fetchOne: MockFunction;
  release: MockFunction;

  constructor() {
    this.usable = true;
    this.connect = vi.fn(async () => {});
    this.on = vi.fn();
    this.release = vi.fn();
    this.getMailboxLock = vi.fn(async () => ({ release: this.release }));
    this.search = vi.fn(async () => []);
    this.fetch = vi.fn(async function* () {});
    this.fetchOne = vi.fn(async () => ({ source: Buffer.from([
      "From: Sender <sender@example.com>",
      "Subject: Attachment message",
      "MIME-Version: 1.0",
      'Content-Type: multipart/mixed; boundary="ICLOUD-ATTACHMENT"',
      "",
      "--ICLOUD-ATTACHMENT",
      "Content-Type: text/plain; charset=utf-8",
      "",
      "See the file.",
      "--ICLOUD-ATTACHMENT",
      'Content-Type: text/csv; name="ledger.csv"',
      'Content-Disposition: attachment; filename="ledger.csv"',
      "Content-Transfer-Encoding: base64",
      "",
      Buffer.from("date,amount\n2026-08-25,42").toString("base64"),
      "--ICLOUD-ATTACHMENT--",
    ].join("\r\n")) }));
    activeClient = this as unknown as TestImapClient;
  }
}

// Counts constructions and lets a test control exactly when `connect()`
// settles (resolve, or never — for the timeout test) via `connectDeferred`.
let constructCount = 0;
class ControllableImapFlow {
  usable: boolean;
  connectDeferred: { promise: Promise<void>; resolve: () => void; reject: (reason?: unknown) => void };
  connect: MockFunction;
  close: MockFunction;
  logout: MockFunction;
  on: MockFunction;

  constructor() {
    constructCount += 1;
    this.usable = true;
    this.connectDeferred = (() => {
      let resolve!: () => void;
      let reject!: (reason?: unknown) => void;
      const promise = new Promise<void>((res, rej) => {
        resolve = res;
        reject = rej;
      });
      return { promise, resolve, reject };
    })();
    this.connect = vi.fn(() => this.connectDeferred.promise);
    this.close = vi.fn(async () => {});
    this.logout = vi.fn(async () => {});
    this.on = vi.fn();
    activeClient = this as unknown as TestImapClient;
  }
}

type TestImapConstructor = typeof FakeImapFlow | typeof FakeImapFlowMime | typeof FakeImapFlowAttachment | typeof ControllableImapFlow;
const imapFlowHolder: { current: TestImapConstructor } = { current: FakeImapFlow };
vi.mock("imapflow", () => ({
  ImapFlow: class {
    constructor(..._args: unknown[]) {
      return new imapFlowHolder.current();
    }
  },
}));

const { fetchEmailsInRange, fetchEmailAttachment, getPooledClient } = await import("./icloud.ts");

describe("iCloud fetchEmailsInRange", () => {
  const fakeAccount = {
    id: "icloud-main",
    type: "icloud" as const,
    label: "iCloud",
    email: "me@icloud.com",
    color: "#abcdef",
    icon: "Apple",
    credentials_encrypted: "stub",
  };

  beforeEach(() => {
    activeClient = null;
    imapFlowHolder.current = FakeImapFlow;
  });

  it("fetches a bounded INBOX date window and returns normalized indexable emails", async () => {
    const result = await fetchEmailsInRange(fakeAccount, "app-password", {
      start: "2026-04-25T00:00:00Z",
      end: "2026-05-02T00:00:00Z",
      limit: 25,
    });

    // test-architecture: allow-boundary-interaction -- IMAP mailbox locking is outbound protocol state; inbox scope must be acquired before provider search/fetch.
    expect(activeClient!.getMailboxLock).toHaveBeenCalledWith("INBOX");
    // test-architecture: allow-boundary-interaction -- IMAP search is outbound; exact date bounds are provider wire inputs not represented in normalized messages.
    expect(activeClient!.search).toHaveBeenCalledWith({
      since: new Date("2026-04-25T00:00:00Z"),
      before: new Date("2026-05-02T00:00:00Z"),
    });
    // test-architecture: allow-boundary-interaction -- IMAP fetch is outbound; UID selection and source/header fields are the provider compatibility contract for MIME normalization.
    expect(activeClient!.fetch).toHaveBeenCalledWith([11, 12], {
      envelope: true,
      flags: true,
      bodyStructure: true,
      source: { start: 0, maxLength: 262144 },
    });
    expect(result).toEqual({
      emails: [
        expect.objectContaining({
          uid: "icloud-11",
          account_id: "icloud-main",
          account_label: "iCloud",
          account_email: "me@icloud.com",
          from: "Sender",
          from_email: "sender@example.com",
          subject: "iCloud range message",
          body_preview: "Full iCloud body $45.67 [amounts: $45.67]",
          body_text: "Full iCloud body $45.67",
          date: "2026-05-01T15:00:00.000Z",
          read: true,
          message_id: "<msg-11@icloud.com>",
          thread_id: null,
        }),
      ],
      cursor: null,
    });
  });
});

describe("iCloud fetchEmailsInRange MIME parsing (D1)", () => {
  // Distinct account email so this describe's fetches get a fresh pooled
  // client instead of reusing the one cached by the block above.
  const mimeAccount = {
    id: "icloud-mime",
    type: "icloud" as const,
    label: "iCloud",
    email: "mime@icloud.com",
    color: "#abcdef",
    icon: "Apple",
    credentials_encrypted: "stub",
  };

  beforeEach(() => {
    activeClient = null;
    imapFlowHolder.current = FakeImapFlowMime;
  });

  it("decodes a quoted-printable body (soft breaks rejoined, =XX sequences decoded)", async () => {
    const result = await fetchEmailsInRange(mimeAccount, "app-password", {
      start: "2026-04-25T00:00:00Z",
      end: "2026-05-02T00:00:00Z",
      limit: 25,
    });

    const email = result.emails.find((e) => e.uid === "icloud-21")!;
    expect(email.body_text).toContain("Statement balance $238.80");
    expect(email.body_text).toContain("—");
    expect(email.body_text).not.toContain("=E2=80=94");
    expect(email.body_text).not.toContain("bal=\r\n");
  });

  it("decodes a multipart/base64 html body and strips MIME framing", async () => {
    const result = await fetchEmailsInRange(mimeAccount, "app-password", {
      start: "2026-04-25T00:00:00Z",
      end: "2026-05-02T00:00:00Z",
      limit: 25,
    });

    const email = result.emails.find((e) => e.uid === "icloud-22")!;
    expect(email.body_text).toContain("Minimum payment due $29.00");
    expect(email.body_text).not.toContain("XYZBOUNDARY");
    expect(email.body_text).not.toContain("Content-Transfer-Encoding");
    expect(email.body_preview.endsWith(" [amounts: $29.00]")).toBe(true);
  });
});

describe("iCloud reader attachments", () => {
  beforeEach(() => {
    activeClient = null;
    imapFlowHolder.current = FakeImapFlowAttachment;
  });

  it("retrieves the selected MIME part and always releases the mailbox lock", async () => {
    const attachment = await fetchEmailAttachment(
      "attachments@icloud.com",
      "app-password",
      "icloud-42",
      "2",
    );

    expect(attachment.content.toString()).toContain("2026-08-25,42");
    expect(attachment).toMatchObject({
      filename: "ledger.csv",
      contentType: "text/csv",
    });
    // test-architecture: allow-boundary-interaction -- IMAP source fetch is outbound; the exact UID and raw-source request are the provider attachment contract.
    expect(activeClient!.fetchOne).toHaveBeenCalledWith("42", { source: true }, { uid: true });
    // test-architecture: allow-boundary-interaction -- IMAP mailbox lock release is outbound protocol state and must occur after successful attachment extraction.
    expect((activeClient as unknown as FakeImapFlowAttachment).release).toHaveBeenCalledTimes(1);
  });

  it("releases the mailbox lock when the requested part is missing", async () => {
    await expect(fetchEmailAttachment(
      "missing-attachment@icloud.com",
      "app-password",
      "icloud-42",
      "9",
    )).rejects.toMatchObject({ status: 404 });

    // test-architecture: allow-boundary-interaction -- IMAP mailbox lock release is outbound protocol state and must occur even when attachment lookup fails.
    expect((activeClient as unknown as FakeImapFlowAttachment).release).toHaveBeenCalledTimes(1);
  });
});

describe("iCloud getPooledClient concurrency/timeout (REL-06)", () => {
  beforeEach(() => {
    activeClient = null;
    constructCount = 0;
    imapFlowHolder.current = ControllableImapFlow;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("dedups concurrent connects: only one client is constructed and both callers share it", async () => {
    const p1 = getPooledClient("dedup-a@icloud.com", "pw");
    const p2 = getPooledClient("dedup-a@icloud.com", "pw");

    // Both calls should have synchronously reused the same in-flight entry —
    // only one ImapFlow should have been constructed even though neither
    // connect() has resolved yet.
    expect(constructCount).toBe(1);

    // Now let the single constructed client's connect() resolve.
    activeClient!.connectDeferred.resolve();

    const [client1, client2] = await Promise.all([p1, p2]);

    expect(constructCount).toBe(1);
    expect(client1).toBe(client2);
    expect(client1).toBe(activeClient);
  });

  it("rejects after the connect timeout and evicts the pool entry so the next call retries", async () => {
    vi.useFakeTimers();

    const pending = getPooledClient("timeout-b@icloud.com", "pw");
    pending.catch(() => {}); // avoid unhandled-rejection noise while we advance timers

    // connect() never settles — advance past ICLOUD_CONNECT_TIMEOUT_MS (15s).
    await vi.advanceTimersByTimeAsync(15_001);

    await expect(pending).rejects.toThrow(/iCloud IMAP connect timed out after 15000ms/);
    expect(constructCount).toBe(1);

    // A subsequent call must construct a fresh client — the failed entry was
    // evicted, not left dangling in the pool.
    const nextClientPromise = getPooledClient("timeout-b@icloud.com", "pw");
    expect(constructCount).toBe(2);
    activeClient!.connectDeferred.resolve();

    await vi.runOnlyPendingTimersAsync();
    const nextClient = await nextClientPromise;
    expect(nextClient).toBe(activeClient);

    vi.useRealTimers();
  });
});
