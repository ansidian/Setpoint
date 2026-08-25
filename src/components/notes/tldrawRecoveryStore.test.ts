import { IDBFactory } from "fake-indexeddb";
import { afterEach, describe, expect, it } from "vitest";
import type { TldrawRecoveryDraft } from "./tldrawRecoveryModel";
import { createTldrawRecoveryStore, type TldrawRecoveryStore } from "./tldrawRecoveryStore";

const openStores: TldrawRecoveryStore[] = [];

function createStore(): TldrawRecoveryStore {
  const store = createTldrawRecoveryStore({
    indexedDB: new IDBFactory(),
    databaseName: `ea-tldraw-recovery-${crypto.randomUUID()}`,
  });
  openStores.push(store);
  return store;
}

function draft(id: string, marker = id): TldrawRecoveryDraft {
  return {
    version: 1,
    id,
    document: {
      store: { [marker]: { id: marker, typeName: "page" } },
      schema: { schemaVersion: 2, sequences: {} },
    },
    baseRevision: 7,
    updatedAt: "2026-08-25T12:00:00.000Z",
  };
}

afterEach(async () => {
  await Promise.all(openStores.splice(0).map((store) => store.close()));
});

describe("tldrawRecoveryStore", () => {
  it("round-trips a recovery draft through IndexedDB", async () => {
    const store = createStore();
    const expected = draft("draft-a");

    await store.write(expected);

    expect(await store.read()).toEqual(expected);
  });

  it("clears only the exact draft confirmed by a server save", async () => {
    const store = createStore();
    await store.write(draft("draft-a"));
    await store.write(draft("draft-b"));

    expect(await store.clearIfCurrent("draft-a")).toBe(false);
    expect(await store.read()).toEqual(draft("draft-b"));
    expect(await store.clearIfCurrent("draft-b")).toBe(true);
    expect(await store.read()).toBeNull();
  });

  it("rejects malformed drafts instead of claiming they are protected", async () => {
    const store = createStore();

    await expect(store.write({ version: 1, id: "broken" } as TldrawRecoveryDraft))
      .rejects.toThrow("Invalid tldraw recovery draft");
    expect(await store.read()).toBeNull();
  });
});

