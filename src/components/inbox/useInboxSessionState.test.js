import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import useInboxSessionState, {
  DEFAULT_INBOX_SESSION,
  getInboxSession,
  resetInboxSession,
  setInboxSession,
  useInboxSessionStore,
} from "./useInboxSessionState.js";
import { EMPTY_INBOX_AI_SEARCH } from "./inboxAiSearchModel.js";

afterEach(() => {
  resetInboxSession();
});

describe("inbox session store", () => {
  it("starts from the default session and accepts useState-style updates", () => {
    expect(getInboxSession()).toEqual(DEFAULT_INBOX_SESSION);

    setInboxSession((prev) => ({ ...prev, selectedId: "email-1" }));
    expect(getInboxSession().selectedId).toBe("email-1");
    expect(getInboxSession().lane).toBe("__all");

    resetInboxSession();
    expect(getInboxSession()).toEqual(DEFAULT_INBOX_SESSION);
  });

  it("keeps subscribed components in sync across hook instances", () => {
    const first = renderHook(() => useInboxSessionStore());
    const second = renderHook(() => useInboxSessionStore());

    act(() => {
      setInboxSession((prev) => ({ ...prev, lane: "fyi" }));
    });

    expect(first.result.current[0].lane).toBe("fyi");
    expect(second.result.current[0].lane).toBe("fyi");

    first.unmount();
    act(() => {
      setInboxSession((prev) => ({ ...prev, lane: "noise" }));
    });
    expect(second.result.current[0].lane).toBe("noise");
  });
});

describe("useInboxSessionState field accessors", () => {
  function renderAccessors(initial = {}) {
    let sessionState = { ...DEFAULT_INBOX_SESSION, ...initial };
    const onSessionStateChange = vi.fn((updater) => {
      sessionState = typeof updater === "function" ? updater(sessionState) : updater;
    });
    const hook = renderHook(
      (props) => useInboxSessionState(props),
      { initialProps: { sessionState, onSessionStateChange } },
    );
    return {
      hook,
      readSession: () => sessionState,
      rerender: () => hook.rerender({ sessionState, onSessionStateChange }),
    };
  }

  it("normalizes missing fields to defaults", () => {
    const onSessionStateChange = vi.fn();
    const { result } = renderHook(() => useInboxSessionState({
      sessionState: {},
      onSessionStateChange,
    }));

    expect(result.current.accountId).toBe("__all");
    expect(result.current.lane).toBe("__all");
    expect(result.current.search).toBe("");
    expect(result.current.selectedId).toBeNull();
    expect(result.current.inboxAiSearch).toBe(EMPTY_INBOX_AI_SEARCH);
  });

  it("writes individual fields through the session setter", () => {
    const { hook, readSession } = renderAccessors();

    act(() => {
      hook.result.current.setLane("fyi");
      hook.result.current.setAccountId("acc-work");
      hook.result.current.setSelectedId("email-9");
    });

    expect(readSession()).toMatchObject({
      lane: "fyi",
      accountId: "acc-work",
      selectedId: "email-9",
    });
  });

  it("clears a non-idle AI search when the plain search changes", () => {
    const { hook, readSession, rerender } = renderAccessors({
      inboxAiSearch: { ...EMPTY_INBOX_AI_SEARCH, status: "result", query: "rent" },
    });

    act(() => {
      hook.result.current.setSearch("lease");
    });
    rerender();

    expect(readSession().search).toBe("lease");
    expect(readSession().inboxAiSearch.status).toBe("idle");
  });

  it("leaves an idle AI search untouched when searching", () => {
    const { hook, readSession } = renderAccessors();

    act(() => {
      hook.result.current.setSearch("lease");
    });

    expect(readSession().search).toBe("lease");
    expect(readSession().inboxAiSearch).toBe(EMPTY_INBOX_AI_SEARCH);
  });
});
