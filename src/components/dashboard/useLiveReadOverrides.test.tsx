import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import useLiveReadOverrides from "./useLiveReadOverrides";
import type { DashboardActiveSnapshotController } from "./useLiveReadOverrides";
import type { CurrentDashboardLiveData } from "../../hooks/currentDashboardModel";

const snapshotItem = {
  id: 42,
  snapshot_item_id: 42,
  uid: "snapshot-read",
  email_id: "snapshot-read",
  account_id: "gmail-a",
  lane: "needs_attention",
  subject: "Read in session",
  read: false,
};

function controller(items: unknown[]): DashboardActiveSnapshotController {
  return {
    snapshot: {
      snapshot: { id: 77, updated_at: "2026-05-07T15:00:00.000Z" },
      filters: { accounts: [], categories: [] },
      carryover: [],
      lanes: { needs_attention: items, fyi: [], handled: [], noise: [] },
    } as unknown as DashboardActiveSnapshotController["snapshot"],
    loading: false,
    error: null,
    refresh: async () => {},
    sync: async () => {},
  };
}

const liveData = { liveEmails: [], resurfacedEntries: [] } as unknown as CurrentDashboardLiveData;

describe("useLiveReadOverrides", () => {
  it("keeps a read override across dashboard payload identities and prunes it after the email leaves", async () => {
    const { result, rerender } = renderHook(
      ({ activeSnapshot }) => useLiveReadOverrides({ activeSnapshot, liveData }),
      { initialProps: { activeSnapshot: controller([snapshotItem]) } },
    );

    act(() => result.current.handleLiveReadOverrideChange("snapshot-read", true));
    expect(result.current.liveReadOverrides).toEqual({ "snapshot-read": true });
    expect(result.current.inboxUnreadSignalCount).toBe(0);

    rerender({ activeSnapshot: controller([{ ...snapshotItem }]) });
    expect(result.current.liveReadOverrides).toEqual({ "snapshot-read": true });

    rerender({ activeSnapshot: controller([]) });
    await waitFor(() => expect(result.current.liveReadOverrides).toEqual({}));
  });
});
