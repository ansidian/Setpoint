import { memo } from "react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import TimelineDayGroup from "./TimelineDayGroup.jsx";

// PERF-L01: TimelineDayGroup must derive now-dependent row primitives once per
// item (memoized on [items, now, isMobile]) so TimelineRow's own memo can bail
// on a 30s tick for rows whose derived state didn't actually change. Mocking
// TimelineRow here (rather than in TimelineDayGroup.test.jsx) keeps that
// file's real in-card-marker assertions intact — this file only probes render
// counts per row.
const { rowRenderCalls } = vi.hoisted(() => ({ rowRenderCalls: [] }));

vi.mock("./TimelineRow", () => ({
  default: memo(function TimelineRowMock(props) {
    rowRenderCalls.push(props);
    return <div data-testid={`row-${props.item.data.id}`} />;
  }),
}));

afterEach(() => {
  cleanup();
  rowRenderCalls.length = 0;
});

function makeEvent(id, startIso, endIso) {
  const startMs = new Date(startIso).getTime();
  const endMs = new Date(endIso).getTime();
  return {
    kind: "event",
    startMs,
    endMs,
    data: { id, title: id, startMs, endMs },
  };
}

describe("TimelineDayGroup row-level memoization", () => {
  it("only re-renders the live row on a 30s tick that crosses no row boundary", () => {
    const baseNow = new Date("2026-05-05T20:25:00.000Z").getTime();
    const items = [
      makeEvent("past-1", "2026-05-05T18:00:00.000Z", "2026-05-05T19:00:00.000Z"),
      makeEvent("live-1", "2026-05-05T20:00:00.000Z", "2026-05-05T21:00:00.000Z"),
      makeEvent("future-1", "2026-05-05T22:00:00.000Z", "2026-05-05T23:00:00.000Z"),
    ];
    // Stable across both renders — a fresh arrow function per render would
    // defeat every row's memo regardless of the fix under test.
    const onJump = () => {};

    const { rerender } = render(
      <TimelineDayGroup accent="#cba6da" day={0} isFirst items={items} now={baseNow} onJump={onJump} />,
    );

    const callsAfterFirstRender = rowRenderCalls.length;
    expect(callsAfterFirstRender).toBe(3);
    const firstLiveCall = rowRenderCalls.find((p) => p.item.data.id === "live-1");

    // Same items reference, `now` advanced 30s — none of the 3 rows cross a
    // past/live/future boundary in that window.
    rerender(
      <TimelineDayGroup accent="#cba6da" day={0} isFirst items={items} now={baseNow + 30000} onJump={onJump} />,
    );

    const newCalls = rowRenderCalls.slice(callsAfterFirstRender);
    const rerenderedIds = newCalls.map((p) => p.item.data.id);

    expect(rerenderedIds).toEqual(["live-1"]);
    const secondLiveCall = newCalls.find((p) => p.item.data.id === "live-1");
    expect(secondLiveCall.liveMarker.pct).not.toBe(firstLiveCall.liveMarker.pct);
  });
});
