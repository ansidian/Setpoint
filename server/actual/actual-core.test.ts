import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

interface MockActualApi {
  init: ReturnType<typeof vi.fn>;
  downloadBudget: ReturnType<typeof vi.fn>;
  shutdown: ReturnType<typeof vi.fn>;
  sync: ReturnType<typeof vi.fn>;
}

const config = vi.hoisted(() => ({
  current: { serverURL: "http://localhost", password: "server", syncId: "sync-123", encryptionPassword: null as string | null },
}));

const actualLocalMock = vi.hoisted(() => ({
  actualDataDir: vi.fn(() => "/var/ea-actual"),
  getActualConfig: vi.fn(async () => ({ ...config.current })),
  findLocalBudgetDir: vi.fn().mockResolvedValue(null),
  pruneActualBudgetBackups: vi.fn().mockResolvedValue({ removed: 0, kept: 0 }),
  describeLocalActualCache: vi.fn().mockResolvedValue({ success: true, configured: true, hydrated: true }),
  readLocalActualMetadata: vi.fn().mockResolvedValue({ accounts: [], payees: [], payeeMap: {}, categories: [], schedules: [], recentTransactions: [] }),
}));

vi.mock("@actual-app/api", () => ({
  default: {
    init: vi.fn().mockResolvedValue(undefined),
    downloadBudget: vi.fn().mockResolvedValue(undefined),
    shutdown: vi.fn().mockResolvedValue(undefined),
    sync: vi.fn().mockResolvedValue(undefined),
  },
}));
// test-architecture: allow-boundary-mock -- Stored connection settings and the local budget directory are database/filesystem boundaries supplied per case.
vi.mock("./actual-local-metadata.ts", () => actualLocalMock);

async function sdk(): Promise<MockActualApi> {
  return (await import("@actual-app/api")).default as unknown as MockActualApi;
}

let tempDir: string | null = null;

beforeEach(async () => {
  vi.resetModules();
  const actualApi = await sdk();
  Object.values(actualApi).forEach((fn) => fn.mockReset().mockResolvedValue(undefined));
  config.current = { serverURL: "http://localhost", password: "server", syncId: "sync-123", encryptionPassword: null };
  actualLocalMock.findLocalBudgetDir.mockReset().mockResolvedValue(null);
  actualLocalMock.pruneActualBudgetBackups.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = null;
});

describe("Actual SDK session", () => {
  it("serializes concurrent operations and keeps the loaded budget for the next one", async () => {
    const actualApi = await sdk();
    let releaseFirst!: () => void;
    actualApi.sync.mockImplementationOnce(() => new Promise<void>((resolve) => { releaseFirst = resolve; }));
    const { syncMetadata } = await import("./actual-core.ts");

    const first = syncMetadata("user1");
    const second = syncMetadata("user1");
    await vi.waitFor(() => expect(releaseFirst).toBeTypeOf("function"));
    // test-architecture: allow-boundary-interaction -- The SDK is a process-wide singleton; the second caller must not reach it while the first holds the lock.
    expect(actualApi.sync).toHaveBeenCalledTimes(1);
    releaseFirst();
    await Promise.all([first, second]);

    // test-architecture: allow-boundary-interaction -- Opening a budget downloads or syncs it remotely; a healthy session must be opened once.
    expect(actualApi.downloadBudget).toHaveBeenCalledTimes(1);
    // test-architecture: allow-boundary-interaction -- The queued second caller runs its own sync once the lock is released.
    expect(actualApi.sync).toHaveBeenCalledTimes(2);
  });

  it("opens an end-to-end encrypted budget with its encryption password, and a plain budget without one", async () => {
    const actualApi = await sdk();
    const { syncMetadata, shutdownActual } = await import("./actual-core.ts");

    await syncMetadata("user1");
    config.current = { ...config.current, encryptionPassword: "budget-key" };
    await syncMetadata("user1");
    await shutdownActual();

    // test-architecture: allow-boundary-interaction -- The encryption password is only observable as the SDK download argument; it is never persisted by the SDK adapter.
    expect(actualApi.downloadBudget.mock.calls).toEqual([["sync-123", undefined], ["sync-123", { password: "budget-key" }]]);
  });

  it("replaces a stale local copy once after a key error", async () => {
    const actualApi = await sdk();
    tempDir = mkdtempSync(path.join(tmpdir(), "actual-stale-"));
    writeFileSync(path.join(tempDir, "metadata.json"), "{}");
    actualLocalMock.findLocalBudgetDir.mockResolvedValue({ budgetDir: tempDir, metadata: { id: "Budget", groupId: "sync-123", cloudFileId: "file" } });
    actualApi.downloadBudget.mockRejectedValueOnce(Object.assign(new Error("We had an unknown problem opening"), { code: "decrypt-failure" }));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { syncMetadata } = await import("./actual-core.ts");

    await syncMetadata("user1");

    expect(existsSync(tempDir)).toBe(false);
    // test-architecture: allow-boundary-interaction -- Recovery is a second remote download after the stale cache is removed.
    expect(actualApi.downloadBudget).toHaveBeenCalledTimes(2);
  });

  it("keeps the local copy when opening fails for any other reason", async () => {
    const actualApi = await sdk();
    tempDir = mkdtempSync(path.join(tmpdir(), "actual-network-"));
    actualLocalMock.findLocalBudgetDir.mockResolvedValue({ budgetDir: tempDir, metadata: { id: "Budget", groupId: "sync-123", cloudFileId: "file" } });
    actualApi.downloadBudget.mockRejectedValueOnce(Object.assign(new Error("Could not get remote files"), { code: "network-failure" }));
    const { syncMetadata } = await import("./actual-core.ts");

    await expect(syncMetadata("user1")).rejects.toMatchObject({ code: "network-failure" });
    expect(existsSync(tempDir)).toBe(true);
  });

  it("prunes local backups only once across successive successful operations", async () => {
    actualLocalMock.findLocalBudgetDir.mockResolvedValue({
      budgetDir: "/var/ea-actual/Budget-Local",
      metadata: { id: "Budget-Local", groupId: "sync-123", cloudFileId: "file-1" },
    });
    const { syncMetadata, hydrateCache } = await import("./actual-core.ts");

    await syncMetadata("user1");
    await hydrateCache("user1");

    // test-architecture: allow-boundary-interaction -- Backup pruning is a filesystem boundary effect; the interval contract is that successive operations perform one sweep.
    expect(actualLocalMock.pruneActualBudgetBackups).toHaveBeenCalledTimes(1);
  });
});
