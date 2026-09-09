import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import useEmailBody from "./useEmailBody";
import { getEmailBody, peekEmailBody } from "../../../api";

// test-architecture: allow-boundary-mock -- src/api.ts is the authenticated email-body HTTP boundary; provider failures are controlled while the real fallback hook runs.
vi.mock("../../../api", () => ({
  getEmailBody: vi.fn(),
  peekEmailBody: vi.fn(() => null),
}));

afterEach(() => {
  vi.clearAllMocks();
  vi.mocked(peekEmailBody).mockReturnValue(null);
});

describe("useEmailBody", () => {
  it("falls back to the row preview when the provider body is stale", async () => {
    vi.mocked(getEmailBody).mockRejectedValueOnce(
      Object.assign(new Error("Message UID 3221 not found"), { status: 404 }),
    );

    const { result } = renderHook(() => useEmailBody({
      uid: "icloud-3221",
      preview: "Cached preview from the active snapshot.",
    }));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBeNull();
    expect(result.current.body).toBe("Cached preview from the active snapshot.");
    expect(result.current.source).toBe("fallback");
  });

  it("falls back to the preview on a non-404 failure when a fallback exists", async () => {
    vi.mocked(getEmailBody).mockRejectedValueOnce(
      Object.assign(new Error("Internal Server Error"), { status: 503 }),
    );

    const { result } = renderHook(() => useEmailBody({
      uid: "icloud-9001",
      preview: "Preview survives a transient 5xx.",
    }));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBeNull();
    expect(result.current.body).toBe("Preview survives a transient 5xx.");
    expect(result.current.source).toBe("fallback");
  });

  it("surfaces an error when a failure has no fallback body", async () => {
    vi.mocked(getEmailBody).mockRejectedValueOnce(
      Object.assign(new Error("Network request failed"), { status: 500 }),
    );

    const { result } = renderHook(() => useEmailBody({
      uid: "icloud-9002",
    }));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.source).toBe("error");
    expect(result.current.body).toBeNull();
    expect(result.current.error).toBe("Network request failed");
  });

  it("preserves attachments and paired sender identity from fresh and cached body responses", async () => {
    const attachment = {
      id: "2",
      filename: "report.pdf",
      contentType: "application/pdf",
      size: 2048,
      inline: false,
    };
    const identity = { account_id: "gmail-work", from_address: "sender@example.com" };
    vi.mocked(getEmailBody).mockResolvedValueOnce({ body: "Loaded body", attachments: [attachment], ...identity });

    const fresh = renderHook(() => useEmailBody({ uid: "gmail-fresh" }));
    await waitFor(() => expect(fresh.result.current.loading).toBe(false));
    expect(fresh.result.current.attachments).toEqual([attachment]);
    expect(fresh.result.current.remoteContentIdentity).toEqual({
      messageKey: "gmail-fresh", accountId: "gmail-work", senderAddress: "sender@example.com",
    });
    fresh.unmount();

    vi.mocked(peekEmailBody).mockReturnValue({ body: "Cached body", attachments: [attachment], ...identity });
    const cached = renderHook(() => useEmailBody({ uid: "gmail-cached" }));
    expect(cached.result.current.loading).toBe(false);
    expect(cached.result.current.attachments).toEqual([attachment]);
    expect(cached.result.current.remoteContentIdentity).toEqual({
      messageKey: "gmail-cached", accountId: "gmail-work", senderAddress: "sender@example.com",
    });
  });

  it("clears prior attachments and sender identity when the selected message changes", async () => {
    vi.mocked(getEmailBody)
      .mockResolvedValueOnce({
        body: "First",
        account_id: "gmail-work",
        from_address: "sender@example.com",
        attachments: [{ id: "2", filename: "first.pdf", contentType: "application/pdf", inline: false }],
      })
      .mockResolvedValueOnce({ body: "Second", attachments: [] });

    const { result, rerender } = renderHook(
      ({ uid }) => useEmailBody({ uid }),
      { initialProps: { uid: "gmail-first" } },
    );
    await waitFor(() => expect(result.current.attachments?.length).toBe(1));
    expect(result.current.remoteContentIdentity?.senderAddress).toBe("sender@example.com");

    rerender({ uid: "gmail-second" });
    expect(result.current.attachments).toEqual([]);
    expect(result.current.remoteContentIdentity).toBeUndefined();
    await waitFor(() => expect(result.current.body).toBe("Second"));
    expect(result.current.attachments).toEqual([]);
    expect(result.current.remoteContentIdentity).toBeUndefined();
  });

  it.each([
    { account_id: "gmail-work" },
    { from_address: "sender@example.com" },
    { from: "Sender <sender@example.com>" },
  ])("does not infer trusted identity from incomplete body metadata: %j", (metadata) => {
    vi.mocked(peekEmailBody).mockReturnValue({ body: "Cached body", ...metadata });
    const { result } = renderHook(() => useEmailBody({ uid: "gmail-cached" }));
    expect(result.current.remoteContentIdentity).toBeUndefined();
  });
});
