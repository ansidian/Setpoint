// @vitest-environment happy-dom
import { act, cleanup, renderHook } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TLStore } from "tldraw";

vi.mock("tldraw", () => ({
  getSnapshot: (store: FakeStore) => ({ document: store.document, session: {} }),
}));

// test-architecture: allow-boundary-mock -- The autosave hook crosses the browser HTTP boundary through this API facade; controlling its result keeps the real scheduling and state logic integrated.
vi.mock("../../api", () => ({ saveTldrawDocument: vi.fn() }));

import { saveTldrawDocument } from "../../api";
import { useTldrawAutosave } from "./useTldrawAutosave";
import { createTldrawRecoveryStore, type TldrawRecoveryStore } from "./tldrawRecoveryStore";
import type { TldrawRecoveryDraft } from "./tldrawRecoveryModel";

type FakeStore = {
  document: Record<string, unknown>;
  listen: (listener: () => void) => () => void;
  emitChange: (document: Record<string, unknown>) => void;
};

const initialDocument = {
  store: { "page:page": { id: "page:page", typeName: "page" } },
  schema: { schemaVersion: 2, sequences: {} },
};

function createStore(): FakeStore {
  let listener: (() => void) | null = null;
  return {
    document: initialDocument,
    listen(nextListener) {
      listener = nextListener;
      return () => { listener = null; };
    },
    emitChange(document) {
      this.document = document;
      listener?.();
    },
  };
}

let recoveryStore: TldrawRecoveryStore;

function renderAutosave(store: FakeStore, initialRecoveryDraft: TldrawRecoveryDraft | null = null) {
  return renderHook(() => useTldrawAutosave({
    store: store as unknown as TLStore,
    initialRevision: 1,
    initialDocument,
    initialRecoveryDraft,
    recoveryStore,
  }));
}

describe("useTldrawAutosave", () => {
  beforeEach(() => {
    // fake-indexeddb schedules transaction work with setImmediate, so keep that
    // browser-boundary scheduler real while controlling the hook's timeouts.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    recoveryStore = createTldrawRecoveryStore({
      indexedDB: new IDBFactory(),
      databaseName: `ea-tldraw-autosave-${crypto.randomUUID()}`,
    });
    vi.mocked(saveTldrawDocument).mockResolvedValue({
      revision: 2,
      updatedAt: "2026-08-25T12:00:00.000Z",
      unchanged: false,
    });
  });

  afterEach(async () => {
    cleanup();
    await recoveryStore.close();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("coalesces a burst of canvas changes into one save of the newest document", async () => {
    const store = createStore();
    renderAutosave(store);

    act(() => {
      store.emitChange({ ...initialDocument, store: { ...initialDocument.store, first: { id: "first" } } });
      store.emitChange({ ...initialDocument, store: { ...initialDocument.store, latest: { id: "latest" } } });
      vi.advanceTimersByTime(4_999);
    });
    // test-architecture: allow-boundary-interaction -- The quiet window's traffic guarantee is observable only as the absence of an outbound save request.
    expect(saveTldrawDocument).not.toHaveBeenCalled();

    await act(async () => { await vi.advanceTimersByTimeAsync(1); });

    // test-architecture: allow-boundary-interaction -- Request count is the outbound traffic contract for a coalesced edit burst.
    expect(saveTldrawDocument).toHaveBeenCalledTimes(1);
    // test-architecture: allow-boundary-interaction -- The newest snapshot and base revision are the durable HTTP payload contract.
    expect(saveTldrawDocument).toHaveBeenCalledWith({
      document: { ...initialDocument, store: { ...initialDocument.store, latest: { id: "latest" } } },
      baseRevision: 1,
    });
  });

  it("shows Saved only after an actual save and clears it after three seconds", async () => {
    const store = createStore();
    const { result } = renderAutosave(store);

    expect(result.current.state).toBe("idle");
    act(() => store.emitChange({ ...initialDocument, store: { changed: { id: "changed" } } }));
    expect(result.current.state).toBe("idle");

    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
    expect(result.current.state).toBe("saved");

    act(() => vi.advanceTimersByTime(2_999));
    expect(result.current.state).toBe("saved");
    act(() => vi.advanceTimersByTime(1));
    expect(result.current.state).toBe("idle");
  });

  it("does not show Saved or send traffic when a dirty event resolves to the stored snapshot", async () => {
    const store = createStore();
    const { result } = renderAutosave(store);

    act(() => store.emitChange(initialDocument));
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });

    expect(result.current.state).toBe("idle");
    // test-architecture: allow-boundary-interaction -- The absence of an outbound request is the durable contract for a content-identical canvas event.
    expect(saveTldrawDocument).not.toHaveBeenCalled();
  });

  it("stops saving after a stale-device conflict", async () => {
    vi.mocked(saveTldrawDocument).mockRejectedValueOnce({ status: 409 });
    const store = createStore();
    const { result } = renderAutosave(store);

    act(() => store.emitChange({ ...initialDocument, store: { conflict: { id: "conflict" } } }));
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
    expect(result.current.state).toBe("conflict");

    act(() => store.emitChange({ ...initialDocument, store: { later: { id: "later" } } }));
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    // test-architecture: allow-boundary-interaction -- After conflict, outbound request count proves the hook did not issue a stale overwrite attempt.
    expect(saveTldrawDocument).toHaveBeenCalledTimes(1);
  });

  it("protects a changed document locally before the quiet server save", async () => {
    const store = createStore();
    renderAutosave(store);
    const changed = { ...initialDocument, store: { local: { id: "local" } } };

    act(() => store.emitChange(changed));
    await act(async () => { await vi.advanceTimersByTimeAsync(350); });

    expect(await recoveryStore.read()).toMatchObject({
      document: changed,
      baseRevision: 1,
    });
    // test-architecture: allow-boundary-interaction -- The recovery guarantee specifically requires local durability before the outbound quiet-save boundary is crossed.
    expect(saveTldrawDocument).not.toHaveBeenCalled();
  });

  it("restores a compatible local draft and resumes the quiet server save", async () => {
    const store = createStore();
    const recoveredDocument = { ...initialDocument, store: { recovered: { id: "recovered" } } };
    store.document = recoveredDocument;
    const recoveredDraft: TldrawRecoveryDraft = {
      version: 1,
      id: "recovered-draft",
      document: recoveredDocument,
      baseRevision: 1,
      updatedAt: "2026-08-25T12:00:00.000Z",
    };
    const { result } = renderAutosave(store, recoveredDraft);

    act(() => result.current.onMount({} as never));
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });

    // test-architecture: allow-boundary-interaction -- Resuming the server save is the observable completion contract for an automatically restored local draft.
    expect(saveTldrawDocument).toHaveBeenCalledWith({
      document: recoveredDocument,
      baseRevision: 1,
    });
  });

  it("keeps and rebases a newer recovery draft when an older save finishes", async () => {
    let resolveSave: ((value: { revision: number; updatedAt: string; unchanged: false }) => void) | null = null;
    vi.mocked(saveTldrawDocument).mockReturnValueOnce(new Promise((resolve) => { resolveSave = resolve; }));
    const store = createStore();
    renderAutosave(store);
    const first = { ...initialDocument, store: { first: { id: "first" } } };
    const newer = { ...initialDocument, store: { newer: { id: "newer" } } };

    act(() => store.emitChange(first));
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
    act(() => store.emitChange(newer));
    await act(async () => { await vi.advanceTimersByTimeAsync(350); });

    await act(async () => {
      resolveSave?.({ revision: 2, updatedAt: "2026-08-25T12:00:01.000Z", unchanged: false });
      await Promise.resolve();
    });

    expect(await recoveryStore.read()).toMatchObject({
      document: newer,
      baseRevision: 2,
    });
  });

  it("clears the matching recovery draft after the server confirms it", async () => {
    const store = createStore();
    renderAutosave(store);

    act(() => store.emitChange({ ...initialDocument, store: { saved: { id: "saved" } } }));
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });

    expect(await recoveryStore.read()).toBeNull();
  });

  it("warns before unload only until the current change is protected locally", async () => {
    const store = createStore();
    renderAutosave(store);
    act(() => store.emitChange({ ...initialDocument, store: { pending: { id: "pending" } } }));

    const pendingUnload = new Event("beforeunload", { cancelable: true });
    expect(window.dispatchEvent(pendingUnload)).toBe(false);

    await act(async () => { await vi.advanceTimersByTimeAsync(350); });
    await recoveryStore.read();
    const protectedUnload = new Event("beforeunload", { cancelable: true });
    expect(window.dispatchEvent(protectedUnload)).toBe(true);
  });
});
