// @vitest-environment happy-dom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TLStore } from "tldraw";

vi.mock("tldraw", () => ({
  getSnapshot: (store: FakeStore) => ({ document: store.document, session: {} }),
}));

// test-architecture: allow-boundary-mock -- The autosave hook crosses the browser HTTP boundary through this API facade; controlling its result keeps the real scheduling and state logic integrated.
vi.mock("../../api", () => ({ saveTldrawDocument: vi.fn() }));

import { saveTldrawDocument } from "../../api";
import { useTldrawAutosave } from "./useTldrawAutosave";

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

describe("useTldrawAutosave", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(saveTldrawDocument).mockResolvedValue({
      revision: 2,
      updatedAt: "2026-08-25T12:00:00.000Z",
      unchanged: false,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("coalesces a burst of canvas changes into one save of the newest document", async () => {
    const store = createStore();
    renderHook(() => useTldrawAutosave({
      store: store as unknown as TLStore,
      initialRevision: 1,
      initialDocument,
    }));

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
    const { result } = renderHook(() => useTldrawAutosave({
      store: store as unknown as TLStore,
      initialRevision: 1,
      initialDocument,
    }));

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
    const { result } = renderHook(() => useTldrawAutosave({
      store: store as unknown as TLStore,
      initialRevision: 1,
      initialDocument,
    }));

    act(() => store.emitChange(initialDocument));
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });

    expect(result.current.state).toBe("idle");
    // test-architecture: allow-boundary-interaction -- The absence of an outbound request is the durable contract for a content-identical canvas event.
    expect(saveTldrawDocument).not.toHaveBeenCalled();
  });

  it("stops saving after a stale-device conflict", async () => {
    vi.mocked(saveTldrawDocument).mockRejectedValueOnce({ status: 409 });
    const store = createStore();
    const { result } = renderHook(() => useTldrawAutosave({
      store: store as unknown as TLStore,
      initialRevision: 1,
      initialDocument,
    }));

    act(() => store.emitChange({ ...initialDocument, store: { conflict: { id: "conflict" } } }));
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
    expect(result.current.state).toBe("conflict");

    act(() => store.emitChange({ ...initialDocument, store: { later: { id: "later" } } }));
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    // test-architecture: allow-boundary-interaction -- After conflict, outbound request count proves the hook did not issue a stale overwrite attempt.
    expect(saveTldrawDocument).toHaveBeenCalledTimes(1);
  });
});
