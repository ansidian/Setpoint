import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  getCanonicalOriginStatus: vi.fn(),
  previewCanonicalOriginChange: vi.fn(),
  changeCanonicalOrigin: vi.fn(),
  stepUpWithPassword: vi.fn(),
}));

// test-architecture: allow-boundary-mock -- canonical-origin preview, step-up, and mutation are authenticated security HTTP boundaries; impact acknowledgement remains rendered.
vi.mock("@/auth/securityApi", () => api);
const { default: CanonicalDomainCard } = await import("./CanonicalDomainCard");

const current = {
  currentOrigin: "https://old.example.com",
  proposedOrigin: "https://old.example.com",
  affectedPasskeys: 0,
  recentAuth: true,
  callbacks: [],
};
const impact = {
  currentOrigin: "https://old.example.com",
  proposedOrigin: "https://new.example.com",
  affectedPasskeys: 2,
  callbacks: [{
    provider: "Google OAuth",
    previousUrl: "https://old.example.com/api/ea/accounts/gmail/callback",
    nextUrl: "https://new.example.com/api/ea/accounts/gmail/callback",
  }],
};

beforeEach(() => {
  api.getCanonicalOriginStatus.mockResolvedValue(current);
  api.previewCanonicalOriginChange.mockResolvedValue(impact);
  api.changeCanonicalOrigin.mockResolvedValue(impact);
  api.stepUpWithPassword.mockResolvedValue({ recentAuth: true });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("CanonicalDomainCard", () => {
  it("previews passkey and callback impact before applying a confirmed change", async () => {
    render(<CanonicalDomainCard />);
    const input = await screen.findByLabelText("Canonical Setpoint URL");
    fireEvent.change(input, { target: { value: "https://new.example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Preview change" }));

    expect(await screen.findByText(/2 registered passkeys/i)).toBeTruthy();
    expect(screen.getByText("Google OAuth")).toBeTruthy();
    expect(screen.getByText("https://new.example.com/api/ea/accounts/gmail/callback")).toBeTruthy();
    fireEvent.click(screen.getByRole("checkbox", { name: /I understand passkeys/i }));
    fireEvent.click(screen.getByRole("button", { name: "Change canonical URL" }));

    // test-architecture: allow-boundary-interaction -- the canonical origin is a security-sensitive outbound mutation and its exact submitted value is not recoverable from the generic success message.
    await waitFor(() => expect(api.changeCanonicalOrigin).toHaveBeenCalledWith("https://new.example.com"));
    expect(await screen.findByText("Canonical URL updated.")).toBeTruthy();
  });

  it("requires password step-up before enabling the guarded change", async () => {
    api.getCanonicalOriginStatus.mockResolvedValue({ ...current, recentAuth: false });
    render(<CanonicalDomainCard />);

    fireEvent.change(await screen.findByLabelText("Current password for domain changes"), {
      target: { value: "correct-password" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Unlock domain changes" }));

    expect(await screen.findByRole("button", { name: "Preview change" })).toBeTruthy();
  });
});
