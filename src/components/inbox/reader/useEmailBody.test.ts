import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import useEmailBody from "./useEmailBody";
import { getEmailBody } from "../../../api";

vi.mock("../../../api", () => ({
  getEmailBody: vi.fn(),
  peekEmailBody: vi.fn(() => null),
}));

afterEach(() => {
  vi.clearAllMocks();
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
});
