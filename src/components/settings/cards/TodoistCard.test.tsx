import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockApi = vi.hoisted(() => ({
  saveTodoistPersonalToken: vi.fn(),
  disconnectTodoistConnection: vi.fn(),
  getTodoistConnectionStatus: vi.fn(),
  stageTodoistOAuthApplication: vi.fn(),
  importTodoistOAuthEnvironment: vi.fn(),
  beginTodoistOAuth: vi.fn(),
  discardTodoistOAuthPending: vi.fn(),
}));
const mockSecurity = vi.hoisted(() => ({
  stepUpWithPassword: vi.fn(),
}));

// test-architecture: allow-boundary-mock -- personal-token persistence and connection refresh cross the authenticated Todoist HTTP boundary.
vi.mock("@/api", () => mockApi);
// test-architecture: allow-boundary-mock -- Todoist OAuth application, callback, status, and disconnect operations cross authenticated provider boundaries.
vi.mock("@/lib/todoistSetupApi", () => mockApi);
// test-architecture: allow-boundary-mock -- protected Todoist credential mutations may require the authenticated password-step-up boundary.
vi.mock("@/auth/securityApi", () => mockSecurity);

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
  application: { configured: false, source: "absent", pendingConfigured: false, pendingStagedAt: null, pendingExpiresAt: null, candidateVersions: null },
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
    mockSecurity.stepUpWithPassword.mockResolvedValue({ recentAuth: true });
  });


  it("saves a freshly entered token and clears the input", async () => {
    render(<TodoistCard settings={{}} />);
    const input = screen.getByPlaceholderText("Todoist API token");
    fireEvent.change(input, { target: { value: "tok-123" } });
    fireEvent.click(screen.getByRole("button", { name: "Save & verify" }));
    await waitFor(() => {
      // test-architecture: allow-boundary-interaction -- the write-only personal token is an outbound provider credential intentionally absent after verification.
      expect(mockApi.saveTodoistPersonalToken).toHaveBeenCalledWith("tok-123");
    });
    expect(await screen.findByText("Connected")).toBeTruthy();
  });

  it("keeps Save disabled until the token is edited", () => {
    render(<TodoistCard settings={{}} />);
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Save & verify" }).disabled).toBe(true);
  });



  it("keeps a rejected candidate in the write-only field without claiming a replacement", async () => {
    mockApi.saveTodoistPersonalToken.mockRejectedValueOnce(new Error("Todoist personal token could not be verified"));
    render(<TodoistCard settings={{ todoist_configured: true, todoist_connection_mode: "oauth" }} />);
    const input = screen.getByLabelText("Personal API token");
    fireEvent.change(input, { target: { value: "bad-token" } });
    fireEvent.click(screen.getByRole("button", { name: "Save & verify" }));

    expect(await screen.findByText(/could not be verified/i)).toBeTruthy();
    expect((input as HTMLInputElement).value).toBe("bad-token");
  });

  it("preserves a personal token while password step-up retries the save", async () => {
    mockApi.saveTodoistPersonalToken
      .mockRejectedValueOnce(Object.assign(new Error("Confirm your password"), {
        code: "PASSWORD_STEP_UP_REQUIRED",
        status: 403,
      }))
      .mockResolvedValueOnce({ success: true, verifiedAt: "2026-07-19T18:00:00.000Z" });
    render(<TodoistCard settings={{}} />);
    const input = screen.getByLabelText("Personal API token") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "tok-private" } });
    fireEvent.click(screen.getByRole("button", { name: "Save & verify" }));

    expect(await screen.findByLabelText("Current password")).toBeTruthy();
    expect(input.value).toBe("tok-private");
    fireEvent.change(screen.getByLabelText("Current password"), { target: { value: "owner-password" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm and retry" }));

    await waitFor(() => expect(input.value).toBe(""));
  });

  it("stages advanced application credentials write-only while keeping personal tokens primary", async () => {
    mockApi.stageTodoistOAuthApplication.mockResolvedValue({ credentials: [] });
    render(<TodoistCard settings={{}} />);

    expect(screen.getByLabelText("Personal API token")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Client ID"), { target: { value: "client-id" } });
    fireEvent.change(screen.getByLabelText("Client secret"), { target: { value: "client-secret" } });
    fireEvent.click(screen.getByRole("button", { name: "Save app credentials" }));

    await waitFor(() => {
      // test-architecture: allow-boundary-interaction -- the atomic write-only OAuth pair is absent from returned redacted application metadata.
      expect(mockApi.stageTodoistOAuthApplication).toHaveBeenCalledWith({
        clientId: "client-id",
        clientSecret: "client-secret",
      });
    });
    expect((screen.getByLabelText("Client ID") as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText("Client secret") as HTMLInputElement).value).toBe("");
    expect(screen.getByText(/personal token stays active until authorization succeeds/i)).toBeTruthy();
  });

  it("preserves the OAuth pair while password step-up retries staging", async () => {
    mockApi.stageTodoistOAuthApplication
      .mockRejectedValueOnce(Object.assign(new Error("Confirm your password"), {
        code: "PASSWORD_STEP_UP_REQUIRED",
        status: 403,
      }))
      .mockResolvedValueOnce({ credentials: [] });
    render(<TodoistCard settings={{}} openAdvancedSetup />);
    const clientId = screen.getByLabelText("Client ID") as HTMLInputElement;
    const clientSecret = screen.getByLabelText("Client secret") as HTMLInputElement;
    fireEvent.change(clientId, { target: { value: "client-id" } });
    fireEvent.change(clientSecret, { target: { value: "client-secret" } });
    fireEvent.click(screen.getByRole("button", { name: "Save app credentials" }));

    expect(await screen.findByLabelText("Current password")).toBeTruthy();
    expect(clientId.value).toBe("client-id");
    expect(clientSecret.value).toBe("client-secret");
    fireEvent.change(screen.getByLabelText("Current password"), { target: { value: "owner-password" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm and retry" }));

    await waitFor(() => expect(clientId.value).toBe(""));
    expect(clientSecret.value).toBe("");
  });

  it("shows OAuth expiry and atomically discards the pair after password step-up", async () => {
    const pendingStatus = {
      ...disconnectedStatus,
      application: {
        configured: true,
        source: "stored" as const,
        pendingConfigured: true,
        pendingStagedAt: Date.UTC(2026, 6, 20, 18),
        pendingExpiresAt: Date.UTC(2026, 6, 21, 18),
        candidateVersions: { clientId: 21, clientSecret: 22 },
      },
    };
    const activeStatus = {
      ...pendingStatus,
      application: { ...pendingStatus.application, pendingConfigured: false, pendingStagedAt: null, pendingExpiresAt: null, candidateVersions: null },
    };
    mockApi.getTodoistConnectionStatus.mockResolvedValueOnce(pendingStatus).mockResolvedValueOnce(activeStatus);
    mockApi.discardTodoistOAuthPending
      .mockRejectedValueOnce(Object.assign(new Error("Confirm your password"), { code: "PASSWORD_STEP_UP_REQUIRED", status: 403 }))
      .mockResolvedValueOnce({ credentials: [] });

    render(<TodoistCard settings={{}} openAdvancedSetup />);
    expect(await screen.findByText(/Pending candidate expires/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Discard pending" }));
    expect(await screen.findByLabelText("Current password")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Current password"), { target: { value: "owner-password" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm and retry" }));

    // test-architecture: allow-boundary-interaction -- pair discard must compare both exact candidate versions so a stale retry cannot remove a newer application.
    expect(mockApi.discardTodoistOAuthPending).toHaveBeenLastCalledWith({ clientId: 21, clientSecret: 22 });
    await waitFor(() => expect(screen.queryByRole("button", { name: "Discard pending" })).toBeNull());
    expect(screen.getByText(/App credentials: stored/)).toBeTruthy();
  });

  it("copies the OAuth pair and explains the Render cleanup boundary", async () => {
    const environmentStatus = {
      ...disconnectedStatus,
      application: { configured: true, source: "environment", pendingConfigured: false },
    };
    const storedStatus = {
      ...environmentStatus,
      application: { configured: true, source: "stored", pendingConfigured: false },
    };
    mockApi.getTodoistConnectionStatus
      .mockResolvedValueOnce(environmentStatus)
      .mockResolvedValueOnce(storedStatus);
    mockApi.importTodoistOAuthEnvironment.mockResolvedValue({ credentials: [] });
    render(<TodoistCard settings={{}} openAdvancedSetup />);

    fireEvent.click(await screen.findByRole("button", { name: "Copy into Setpoint" }));

    expect(await screen.findByText(/render variables still remain/i)).toBeTruthy();
  });

  it("opens only its advanced disclosure when targeted by a deep link", () => {
    render(<TodoistCard settings={{}} openAdvancedSetup />);

    const disclosure = screen.getByText("Advanced OAuth and webhooks").closest("details") as HTMLDetailsElement;
    expect(disclosure.open).toBe(true);
  });

  it("confirms Todoist impact before disconnecting and refreshes shared state", async () => {
    const onRefreshConnections = vi.fn(async () => {});
    render(<TodoistCard settings={{ todoist_configured: true }} onRefreshConnections={onRefreshConnections} />);

    fireEvent.click(screen.getByRole("button", { name: "Disconnect Todoist" }));
    expect(screen.getByText(/task and deadline sync will stop/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Confirm disconnect Todoist" }));

    await waitFor(() => expect(screen.queryByRole("button", { name: "Disconnect Todoist" })).toBeNull());
  });
});
