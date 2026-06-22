import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mockApi = vi.hoisted(() => ({ updateSettings: vi.fn() }));

vi.mock("@/api", () => mockApi);

const { default: TodoistCard } = await import("./TodoistCard.jsx");

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("TodoistCard", () => {
  it("shows Connected and a masked placeholder when already configured", () => {
    render(<TodoistCard settings={{ todoist_configured: true }} />);
    expect(screen.getByText("Connected")).toBeTruthy();
    expect(screen.getByPlaceholderText(/saved/i)).toBeTruthy();
  });

  it("saves a freshly entered token and clears the input", async () => {
    mockApi.updateSettings.mockResolvedValue({ success: true });
    render(<TodoistCard settings={{}} />);
    const input = screen.getByPlaceholderText("Todoist API token");
    fireEvent.change(input, { target: { value: "tok-123" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(mockApi.updateSettings).toHaveBeenCalledWith({ todoist_api_token: "tok-123" });
    });
    expect(await screen.findByText("Connected")).toBeTruthy();
  });

  it("keeps Save disabled until the token is edited", () => {
    render(<TodoistCard settings={{}} />);
    expect(screen.getByRole("button", { name: "Save" }).disabled).toBe(true);
  });
});
