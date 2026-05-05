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
    getEmailBody.mockRejectedValueOnce(
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
});
