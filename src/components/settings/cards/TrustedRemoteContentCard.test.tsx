import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  getRemoteContentTrust: vi.fn(),
  removeRemoteContentTrust: vi.fn(),
  trustRemoteContentSender: vi.fn(),
}));

// test-architecture: allow-boundary-mock -- trusted-sender rows are persisted through the authenticated email API; this card test exercises the real registry hook and UI around that network boundary.
vi.mock("@/api", () => api);

const { default: TrustedRemoteContentCard } = await import("./TrustedRemoteContentCard");

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("TrustedRemoteContentCard", () => {
  it("lists exact sender/account pairs and removes a selected entry", async () => {
    let removedTrustId: string | number | null = null;
    api.getRemoteContentTrust.mockResolvedValueOnce([{
      id: 7,
      account_id: "gmail-work",
      account_label: "Work",
      account_email: "me@work.example",
      sender_address: "news@example.com",
      created_at: "2026-08-12T16:00:00.000Z",
    }]);
    api.removeRemoteContentTrust.mockImplementationOnce(async (id: string | number) => {
      removedTrustId = id;
      return { ok: true };
    });

    render(<TrustedRemoteContentCard />);

    expect(await screen.findByText("news@example.com")).toBeTruthy();
    expect(screen.getByText(/Received by Work/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", {
      name: "Remove trusted sender news@example.com for Work",
    }));

    await waitFor(() => expect(screen.queryByText("news@example.com")).toBeNull());
    expect(removedTrustId).toBe(7);
    expect(screen.getByText(/No trusted senders yet/)).toBeTruthy();
  });
});
