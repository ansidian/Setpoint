import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockApi = vi.hoisted(() => ({
  saveTodoistPersonalToken: vi.fn(),
  disconnectTodoistConnection: vi.fn(),
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
    mockApi.saveTodoistPersonalToken.mockResolvedValue({
      success: true,
      verifiedAt: "2026-07-19T18:00:00.000Z",
    });
    mockApi.disconnectTodoistConnection.mockResolvedValue({ success: true });
  });

  it("shows Connected and a masked placeholder when already configured", () => {
    render(<TodoistCard settings={{ todoist_configured: true }} />);
    expect(screen.getByText("Connected")).toBeTruthy();
    expect(screen.getByPlaceholderText(/saved/i)).toBeTruthy();
  });

  it("saves a freshly entered token and clears the input", async () => {
    render(<TodoistCard settings={{}} />);
    const input = screen.getByPlaceholderText("Todoist API token");
    fireEvent.change(input, { target: { value: "tok-123" } });
    fireEvent.click(screen.getByRole("button", { name: "Save & verify" }));
    await waitFor(() => {
      expect(mockApi.saveTodoistPersonalToken).toHaveBeenCalledWith("tok-123");
    });
    expect(await screen.findByText("Connected")).toBeTruthy();
  });

  it("keeps Save disabled until the token is edited", () => {
    render(<TodoistCard settings={{}} />);
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Save & verify" }).disabled).toBe(true);
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

  it("keeps a rejected candidate in the write-only field without claiming a replacement", async () => {
    mockApi.saveTodoistPersonalToken.mockRejectedValueOnce(new Error("Todoist personal token could not be verified"));
    render(<TodoistCard settings={{ todoist_configured: true, todoist_connection_mode: "oauth" }} />);
    const input = screen.getByLabelText("Personal API token");
    fireEvent.change(input, { target: { value: "bad-token" } });
    fireEvent.click(screen.getByRole("button", { name: "Save & verify" }));

    expect(await screen.findByText(/could not be verified/i)).toBeTruthy();
    expect((input as HTMLInputElement).value).toBe("bad-token");
    expect(mockApi.getTodoistConnectionStatus).toHaveBeenCalledTimes(1);
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

  it("confirms Todoist impact before disconnecting and refreshes shared state", async () => {
    const onRefreshConnections = vi.fn(async () => {});
    render(<TodoistCard settings={{ todoist_configured: true }} onRefreshConnections={onRefreshConnections} />);

    fireEvent.click(screen.getByRole("button", { name: "Disconnect Todoist" }));
    expect(screen.getByText(/task and deadline sync will stop/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Confirm disconnect Todoist" }));

    await waitFor(() => expect(mockApi.disconnectTodoistConnection).toHaveBeenCalledTimes(1));
    expect(onRefreshConnections).toHaveBeenCalledTimes(1);
  });
});
