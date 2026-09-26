import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import useInboxDisplay from "./useInboxDisplay";
import { computeUnreadCount } from "./inboxCountsModel";
import { makeInboxEmail } from "./test-utils/inboxFixtures";
import type { InboxEmailLike, InboxId } from "./inboxTypes";

afterEach(cleanup);
const row = (id: string, fields: Partial<InboxEmailLike> = {}): InboxEmailLike => ({ ...makeInboxEmail(), id, uid: id, _lane: "fyi", read: false, ...fields });
const ids = (rows: InboxEmailLike[]) => rows.map(email => email.id);
const options = (emails: InboxEmailLike[]) => ({ emails, selectedId: null as InboxId | null, lane: "__all", activeSnapshotMode: true, focusUnread: true, scope: "account:snapshot" });

// The disclosure owner composes the real lane projection and arrival policy.
// These assert row eligibility/navigation state, not presentation or callbacks.
describe("focused inbox display", () => {
  it("keeps read pins and action mail, retains read-only lane access, and counts hidden unread rows", () => {
    const emails = [row("read", { read: true }), row("unread"), row("pin", { _pinned: true, read: true }),
      row("needs", { _lane: "needs_attention", read: true }), row("legacy", { _lane: "action", read: true }),
      row("handled", { _lane: "handled", read: true }), row("skipped", { _lane: "untriaged_read" })];
    const { result } = renderHook(() => useInboxDisplay(options(emails)));
    expect(ids(result.current.displayed)).toEqual(["pin", "needs", "legacy", "unread"]);
    expect(result.current.sections.find(section => section.lane === "handled")?.read).toHaveLength(1);
    expect(result.current.sections.find(section => section.lane === "untriaged_read")?.read).toHaveLength(1);
    act(() => result.current.toggleLane("fyi"));
    expect(ids(result.current.displayed)).not.toContain("unread");
    expect(computeUnreadCount(result.current.sections.flatMap(section => section.source))).toBe(1);
    act(() => result.current.toggleLane("fyi"));
    act(() => result.current.toggleRead("fyi"));
    expect(ids(result.current.displayed)).toEqual(["pin", "needs", "legacy", "unread", "read"]);
    act(() => result.current.toggleRead("fyi"));
    expect(ids(result.current.displayed)).not.toContain("read");
  });

  it("retains the open row after it becomes read, then tucks it away when selection leaves", () => {
    const initial = { ...options([row("first"), row("next")]), selectedId: "first" };
    const { result, rerender } = renderHook(useInboxDisplay, { initialProps: initial });
    const emails = [row("first", { read: true }), row("next")];
    rerender({ ...initial, emails });
    expect(ids(result.current.displayed)).toEqual(["first", "next"]);
    rerender({ ...initial, emails, selectedId: "next" });
    expect(ids(result.current.displayed)).toEqual(["next"]);
    rerender({ ...initial, emails, selectedId: "first" });
    expect(ids(result.current.displayed)).toEqual(["first", "next"]);
  });

  it("reopens focused lanes for arrivals, unread changes and triage moves without reopening on metadata updates", () => {
    const initial = options([row("old")]);
    const { result, rerender } = renderHook(useInboxDisplay, { initialProps: initial });
    act(() => result.current.toggleLane("fyi"));
    rerender({ ...initial, emails: [row("old", { subject: "Updated" })] });
    expect(result.current.displayed).toHaveLength(0);
    rerender({ ...initial, emails: [row("old"), row("new")] });
    expect(ids(result.current.displayed)).toEqual(["old", "new"]);
    act(() => result.current.toggleLane("fyi"));
    rerender({ ...initial, emails: [row("old", { read: true }), row("new")] });
    expect(result.current.displayed).toHaveLength(0);
    rerender({ ...initial, emails: [row("old"), row("new")] });
    expect(ids(result.current.displayed)).toEqual(["old", "new"]);
    act(() => result.current.toggleLane("fyi"));
    rerender({ ...initial, emails: [row("queued", { _lane: "queued" }), row("old")] });
    expect(ids(result.current.displayed)).toEqual(["queued"]);
    rerender({ ...initial, emails: [row("queued"), row("old")] });
    expect(ids(result.current.displayed)).toEqual(["queued", "old"]);
  });

  it("keeps navigation through expanded read mail stable without moving the auto-read row", () => {
    const initial = options([row("unread"), row("a", { read: true }), row("b", { read: true }), row("c", { read: true })]);
    const { result, rerender } = renderHook(useInboxDisplay, { initialProps: initial });
    act(() => result.current.toggleRead("fyi"));
    for (const selectedId of ["a", "b", "c"]) {
      rerender({ ...initial, selectedId });
      expect(ids(result.current.displayed)).toEqual(["unread", "a", "b", "c"]);
      expect(ids(result.current.sections[0]!.primary)).toEqual(["unread"]);
    }
    rerender({ ...initial, selectedId: "unread" });
    const emails = [row("unread", { read: true }), ...initial.emails.slice(1)];
    rerender({ ...initial, emails, selectedId: "unread" });
    expect(ids(result.current.sections[0]!.primary)).toEqual(["unread"]);
    expect(ids(result.current.displayed)).toEqual(["unread", "a", "b", "c"]);
    rerender({ ...initial, emails, selectedId: "a" });
    expect(result.current.sections[0]!.primary).toHaveLength(0);
    expect(ids(result.current.displayed)).toEqual(["unread", "a", "b", "c"]);
  });

  it("resets read disclosures at scope/mode boundaries and preserves normal lane choices", () => {
    const initial = { ...options([row("read", { read: true })]), focusUnread: false };
    const { result, rerender } = renderHook(useInboxDisplay, { initialProps: initial });
    act(() => result.current.toggleLane("fyi"));
    rerender({ ...initial, focusUnread: true });
    act(() => result.current.toggleRead("fyi"));
    expect(ids(result.current.displayed)).toEqual(["read"]);
    rerender({ ...initial, focusUnread: true, scope: "different-account:snapshot" });
    expect(result.current.displayed).toHaveLength(0);
    act(() => result.current.toggleRead("fyi"));
    rerender(initial);
    expect(result.current.sections[0]?.collapsed).toBe(true);
    act(() => result.current.toggleLane("fyi"));
    expect(ids(result.current.displayed)).toEqual(["read"]);
    rerender({ ...initial, focusUnread: true });
    expect(result.current.displayed).toHaveLength(0);
  });
});
