import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockApi = vi.hoisted(() => ({
  listApiTokens: vi.fn(),
  createApiToken: vi.fn(),
  revokeApiToken: vi.fn(),
}));

vi.mock("@/api", () => ({
  listApiTokens: mockApi.listApiTokens,
  createApiToken: mockApi.createApiToken,
  revokeApiToken: mockApi.revokeApiToken,
}));

const { default: ApiTokensCard } = await import("./ApiTokensCard.jsx");

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
  Object.assign(navigator, {
    clipboard: {
      writeText: vi.fn(),
    },
  });
});

describe("ApiTokensCard", () => {
  it("shows the loading state before tokens resolve", () => {
    mockApi.listApiTokens.mockReturnValue(new Promise(() => {}));

    render(<ApiTokensCard />);

    expect(screen.getByText("Loading…")).toBeTruthy();
  });

  it("creates a token and shows the one-time secret", async () => {
    render(<ApiTokensCard />);

    await screen.findByText("Phone");

    fireEvent.change(screen.getByPlaceholderText("iPhone Shortcuts"), {
      target: { value: "Phone" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => {
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
      expect(mockApi.revokeApiToken).toHaveBeenCalledWith("token-1");
    });
    expect(screen.queryByText("Phone")).toBeNull();
  });
});
