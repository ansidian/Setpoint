// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { downloadEmailAttachment } from "./emailAttachmentDownload";

const testState = vi.hoisted(() => ({ fetchEmailAttachmentBlob: vi.fn() }));

// test-architecture: allow-boundary-mock -- Demo attachment bytes cross the browser API boundary; this test verifies the local download handoff without issuing a real browser download.
vi.mock("../../../api", () => ({
  fetchEmailAttachmentBlob: testState.fetchEmailAttachmentBlob,
}));

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("downloadEmailAttachment", () => {
  it("clicks a named object URL download before releasing its bytes", async () => {
    vi.useFakeTimers();
    testState.fetchEmailAttachmentBlob.mockResolvedValue(new Blob(["pdf"], { type: "application/pdf" }));
    const boundaryEvents: string[] = [];
    const createObjectUrl = vi.fn(() => {
      boundaryEvents.push("create");
      return "blob:demo-attachment";
    });
    const revokeObjectUrl = vi.fn(() => boundaryEvents.push("revoke"));
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: createObjectUrl });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revokeObjectUrl });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => { boundaryEvents.push("click"); });

    await downloadEmailAttachment("demo-email", {
      id: "2",
      filename: "budget.pdf",
      contentType: "application/pdf",
      inline: false,
    });

    expect(boundaryEvents).toEqual(["create", "click"]);
    await vi.runAllTimersAsync();
    expect(boundaryEvents).toEqual(["create", "click", "revoke"]);
  });
});
