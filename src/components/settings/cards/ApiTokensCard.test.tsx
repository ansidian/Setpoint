import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockApi = vi.hoisted(() => ({
  listApiTokens: vi.fn(),
  createApiToken: vi.fn(),
  revokeApiToken: vi.fn(),
}));

// test-architecture: allow-boundary-mock -- API-token list/create/revoke calls cross the authenticated HTTP boundary while the one-time-secret workflow renders normally.
vi.mock("@/api", () => ({
  listApiTokens: mockApi.listApiTokens,
  createApiToken: mockApi.createApiToken,
  revokeApiToken: mockApi.revokeApiToken,
}));

const { default: ApiTokensCard } = await import("./ApiTokensCard");

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

beforeEach(() => {
  mockApi.listApiTokens.mockResolvedValue([
    {
      id: "token-1",
      label: "Phone",
      scopes: ["actual:write"],
      created_at: Date.UTC(2026, 3, 19),
      last_used_at: null,
      expires_at: Date.UTC(2026, 6, 18),
    },
  ]);
  mockApi.createApiToken.mockResolvedValue({
    token: "secret-token",
    label: "Phone",
    expires_at: Date.UTC(2026, 6, 18),
  });
  mockApi.revokeApiToken.mockResolvedValue({});
  // happy-dom defines navigator.clipboard as a getter-only property, so it can't
  // be reassigned via Object.assign; defineProperty overrides it in both engines.
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText: vi.fn() },
    configurable: true,
    writable: true,
  });
});

describe("ApiTokensCard", () => {

  it("creates a token and shows the one-time secret", async () => {
    render(<ApiTokensCard />);

    await screen.findByText("Phone");

    fireEvent.change(screen.getByPlaceholderText("iPhone Shortcuts"), {
      target: { value: "Phone" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => {
      // test-architecture: allow-boundary-interaction -- token label and powerful Actual-write scope are outbound authorization inputs not recoverable from the one-time secret response.
      expect(mockApi.createApiToken).toHaveBeenCalledWith("Phone", ["actual:write"]);
    });
    expect(screen.getByText("secret-token")).toBeTruthy();
    expect(screen.getByText("Copy now")).toBeTruthy();
    expect(screen.getAllByText(/Expires Jul/i).length).toBeGreaterThan(0);
  });

  it("shows create errors without clearing the form", async () => {
    mockApi.createApiToken.mockRejectedValueOnce(new Error("Mint failed"));

    render(<ApiTokensCard />);

    await screen.findByText("Phone");

    fireEvent.change(screen.getByPlaceholderText("iPhone Shortcuts"), {
      target: { value: "Broken token" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    expect(await screen.findByText("Mint failed")).toBeTruthy();
    expect(screen.getByDisplayValue("Broken token")).toBeTruthy();
  });

  it("revokes a token after confirmation", async () => {
    render(<ApiTokensCard />);

    await screen.findByText("Phone");

    fireEvent.click(screen.getByTitle("Revoke token"));
    fireEvent.click(await screen.findByRole("button", { name: "Confirm" }));

    await waitFor(() => {
      // test-architecture: allow-boundary-interaction -- revocation is an outbound destructive mutation whose exact opaque token identity is not present after the row disappears.
      expect(mockApi.revokeApiToken).toHaveBeenCalledWith("token-1");
    });
    expect(screen.queryByText("Phone")).toBeNull();
  });
});
