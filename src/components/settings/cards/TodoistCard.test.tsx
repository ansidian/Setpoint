import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockApi = vi.hoisted(() => ({
  updateSettings: vi.fn(),
  getTodoistConnectionStatus: vi.fn(),
  stageTodoistOAuthApplication: vi.fn(),
  importTodoistOAuthEnvironment: vi.fn(),
  beginTodoistOAuth: vi.fn(),
}));

vi.mock("@/api", () => mockApi);
vi.mock("@/lib/todoistSetupApi", () => mockApi);

const { default: TodoistCard } = await import("./TodoistCard");

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const disconnectedStatus = {
  mode: "disconnected",
  configured: false,
  oauthRefreshable: false,
  needsReauth: false,
  application: { configured: false, source: "absent", pendingConfigured: false },
  callbackUrl: "https://setpoint.example.com/api/ea/accounts/todoist/callback",
  webhookUrl: "https://setpoint.example.com/api/todoist/webhook",
  deliveryMode: "periodic",
};

describe("TodoistCard", () => {
  beforeEach(() => {
    mockApi.getTodoistConnectionStatus.mockResolvedValue(disconnectedStatus);
  });

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
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Save" }).disabled).toBe(true);
  });

  it("shows a warning pill and Reconnect action when todoist_needs_reauth is true", () => {
    render(<TodoistCard settings={{ todoist_configured: true, todoist_needs_reauth: true }} />);
    expect(screen.getByText(/reconnect needed/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /reconnect/i })).toBeTruthy();
    expect(screen.queryByText("Connected")).toBeNull();
  });

  it("does not show the warning pill when todoist_needs_reauth is false", () => {
    render(<TodoistCard settings={{ todoist_configured: true, todoist_needs_reauth: false }} />);
    expect(screen.getByText("Connected")).toBeTruthy();
    expect(screen.queryByText(/reconnect needed/i)).toBeNull();
  });

  it("disconnects explicitly by saving an empty personal token", async () => {
    mockApi.updateSettings.mockResolvedValue({ success: true });
    render(<TodoistCard settings={{ todoist_configured: true }} />);
    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(mockApi.updateSettings).toHaveBeenCalledWith({ todoist_api_token: "" });
    });
    expect(screen.queryByText("Connected")).toBeNull();
  });

  it("stages advanced application credentials write-only while keeping personal tokens primary", async () => {
    mockApi.stageTodoistOAuthApplication.mockResolvedValue({ credentials: [] });
    render(<TodoistCard settings={{}} />);

    expect(screen.getByLabelText("Personal API token")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Client ID"), { target: { value: "client-id" } });
    fireEvent.change(screen.getByLabelText("Client secret"), { target: { value: "client-secret" } });
    fireEvent.click(screen.getByRole("button", { name: "Save app credentials" }));

    await waitFor(() => {
      expect(mockApi.stageTodoistOAuthApplication).toHaveBeenCalledWith({
        clientId: "client-id",
        clientSecret: "client-secret",
      });
    });
    expect((screen.getByLabelText("Client ID") as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText("Client secret") as HTMLInputElement).value).toBe("");
    expect(screen.getByText(/personal token stays active until authorization succeeds/i)).toBeTruthy();
  });
});
