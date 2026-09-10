import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { FormEvent } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TodoistConnectionStatus } from "../../../../shared/types/tasks";

const mockApi = vi.hoisted(() => ({
  saveTodoistPersonalToken: vi.fn(),
  disconnectTodoistConnection: vi.fn(),
  getTodoistConnectionStatus: vi.fn(),
  stageTodoistOAuthApplication: vi.fn(),
  importTodoistOAuthEnvironment: vi.fn(),
  beginTodoistOAuth: vi.fn(),
  discardTodoistOAuthPending: vi.fn(),
}));
const mockSecurity = vi.hoisted(() => ({ stepUpWithPassword: vi.fn() }));

// test-architecture: allow-boundary-mock -- personal-token persistence and connection refresh cross the authenticated Todoist HTTP boundary.
vi.mock("@/api", () => mockApi);
// test-architecture: allow-boundary-mock -- Todoist OAuth application, callback, status, and disconnect operations cross authenticated provider boundaries.
vi.mock("@/lib/todoistSetupApi", () => mockApi);
// test-architecture: allow-boundary-mock -- protected Todoist credential mutations may require the authenticated password-step-up boundary.
vi.mock("@/auth/securityApi", () => mockSecurity);

const { useTodoistSetup } = await import("./useTodoistSetup");

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const disconnectedStatus: TodoistConnectionStatus = {
  mode: "disconnected",
  configured: false,
  oauthRefreshable: false,
  needsReauth: false,
  application: { configured: false, source: "absent", pendingConfigured: false, pendingStagedAt: null, pendingExpiresAt: null, candidateVersions: null },
  callbackUrl: "https://setpoint.example.com/api/ea/accounts/todoist/callback",
  webhookUrl: "https://setpoint.example.com/api/todoist/webhook",
  deliveryMode: "periodic",
};
const pendingStatus: TodoistConnectionStatus = {
  ...disconnectedStatus,
  application: {
    configured: true,
    source: "stored",
    pendingConfigured: true,
    pendingStagedAt: Date.UTC(2026, 6, 20, 18),
    pendingExpiresAt: Date.UTC(2026, 6, 21, 18),
    candidateVersions: { clientId: 21, clientSecret: 22 },
  },
};
const activeStatus: TodoistConnectionStatus = {
  ...pendingStatus,
  mode: "oauth",
  configured: true,
  oauthRefreshable: true,
  application: { ...pendingStatus.application, pendingConfigured: false, pendingStagedAt: null, pendingExpiresAt: null, candidateVersions: null },
};

function passwordStepUpRequired() {
  return Object.assign(new Error("Confirm your password"), { code: "PASSWORD_STEP_UP_REQUIRED", status: 403 });
}

async function unlock(result: { current: ReturnType<typeof useTodoistSetup> }) {
  act(() => result.current.stepUp.setPassword("owner-password"));
  await act(async () => {
    await result.current.stepUp.unlock({ preventDefault() {} } as FormEvent<HTMLFormElement>);
  });
}

describe("Todoist setup credential workflow", () => {
  beforeEach(() => {
    mockApi.getTodoistConnectionStatus.mockResolvedValue(disconnectedStatus);
    mockApi.saveTodoistPersonalToken.mockResolvedValue({ success: true, verifiedAt: "2026-07-19T18:00:00.000Z" });
    mockApi.disconnectTodoistConnection.mockResolvedValue({ success: true });
    mockSecurity.stepUpWithPassword.mockResolvedValue({ recentAuth: true });
  });

  it("verifies a personal token and clears the write-only candidate", async () => {
    const { result } = renderHook(() => useTodoistSetup({ settings: {} }));
    act(() => result.current.editToken("tok-123"));
    await act(async () => { await result.current.handleSaveTodoistSecret(); });

    // test-architecture: allow-boundary-interaction -- the write-only personal token is an outbound provider credential intentionally absent after verification.
    expect(mockApi.saveTodoistPersonalToken).toHaveBeenCalledWith("tok-123");
    expect(result.current.todoistConfigured).toBe(true);
    expect(result.current.todoistToken).toBe("");
    expect(result.current.todoistDirty).toBe(false);
  });

  it("retains a rejected candidate without replacing the working connection", async () => {
    mockApi.getTodoistConnectionStatus.mockResolvedValue(activeStatus);
    mockApi.saveTodoistPersonalToken.mockRejectedValueOnce(new Error("Rejected"));
    const { result } = renderHook(() => useTodoistSetup({ settings: { todoist_configured: true, todoist_connection_mode: "oauth" } }));
    await waitFor(() => expect(result.current.oauthStatus?.mode).toBe("oauth"));
    act(() => result.current.editToken("bad-token"));
    await act(async () => { await result.current.handleSaveTodoistSecret(); });

    expect(result.current.todoistToken).toBe("bad-token");
    expect(result.current.todoistDirty).toBe(true);
    expect(result.current.todoistConfigured).toBe(true);
    expect(result.current.oauthStatus).toEqual(activeStatus);
    expect(result.current.todoistSavingSecret).toBe(false);
  });

  it("preserves a personal token through password step-up and clears it after retry", async () => {
    mockApi.saveTodoistPersonalToken.mockRejectedValueOnce(passwordStepUpRequired());
    const { result } = renderHook(() => useTodoistSetup({ settings: {} }));
    act(() => result.current.editToken("tok-private"));
    await act(async () => { await result.current.handleSaveTodoistSecret(); });

    expect(result.current.credentialActionLocked).toBe(true);
    expect(result.current.todoistToken).toBe("tok-private");
    expect(result.current.todoistConfigured).toBe(false);
    await unlock(result);

    expect(result.current.todoistToken).toBe("");
    expect(result.current.todoistConfigured).toBe(true);
    expect(result.current.credentialActionLocked).toBe(false);
    expect(result.current.stepUp.password).toBe("");
  });

  it("stages the OAuth pair atomically and clears both write-only fields", async () => {
    mockApi.stageTodoistOAuthApplication.mockResolvedValue({ credentials: [] });
    mockApi.getTodoistConnectionStatus.mockResolvedValueOnce(disconnectedStatus).mockResolvedValueOnce(pendingStatus);
    const { result } = renderHook(() => useTodoistSetup({ settings: { todoist_configured: true } }));
    act(() => {
      result.current.setClientId("client-id");
      result.current.setClientSecret("client-secret");
    });
    await act(async () => { await result.current.handleSaveOAuthApplication(); });

    // test-architecture: allow-boundary-interaction -- the atomic write-only OAuth pair is absent from returned redacted application metadata.
    expect(mockApi.stageTodoistOAuthApplication).toHaveBeenCalledWith({ clientId: "client-id", clientSecret: "client-secret" });
    expect(result.current.clientId).toBe("");
    expect(result.current.clientSecret).toBe("");
    expect(result.current.oauthStatus?.application).toEqual(pendingStatus.application);
    expect(result.current.todoistConfigured).toBe(true);
  });

  it("preserves the OAuth pair while password step-up retries staging", async () => {
    mockApi.stageTodoistOAuthApplication.mockRejectedValueOnce(passwordStepUpRequired()).mockResolvedValueOnce({ credentials: [] });
    mockApi.getTodoistConnectionStatus.mockResolvedValueOnce(disconnectedStatus).mockResolvedValueOnce(pendingStatus);
    const { result } = renderHook(() => useTodoistSetup({ settings: {} }));
    act(() => {
      result.current.setClientId("client-id");
      result.current.setClientSecret("client-secret");
    });
    await act(async () => { await result.current.handleSaveOAuthApplication(); });

    expect(result.current.credentialActionLocked).toBe(true);
    expect(result.current.clientId).toBe("client-id");
    expect(result.current.clientSecret).toBe("client-secret");
    await unlock(result);

    expect(result.current.clientId).toBe("");
    expect(result.current.clientSecret).toBe("");
    expect(result.current.oauthStatus?.application.pendingConfigured).toBe(true);
    expect(result.current.credentialActionLocked).toBe(false);
  });

  it("requests discard of the exact pending pair after password step-up and refreshes status", async () => {
    const activeWithPending = { ...activeStatus, application: pendingStatus.application };
    mockApi.getTodoistConnectionStatus.mockResolvedValueOnce(activeWithPending).mockResolvedValueOnce(activeStatus);
    mockApi.discardTodoistOAuthPending.mockRejectedValueOnce(passwordStepUpRequired()).mockResolvedValueOnce({ credentials: [] });
    const { result } = renderHook(() => useTodoistSetup({ settings: { todoist_configured: true } }));
    await waitFor(() => expect(result.current.oauthStatus?.application.candidateVersions).toEqual({ clientId: 21, clientSecret: 22 }));
    await act(async () => { await result.current.handleDiscardOAuthApplication(); });
    expect(result.current.credentialActionLocked).toBe(true);
    expect(result.current.oauthStatus?.application.pendingConfigured).toBe(true);
    await unlock(result);

    // test-architecture: allow-boundary-interaction -- pair discard must compare both exact candidate versions so a stale retry cannot remove a newer application.
    expect(mockApi.discardTodoistOAuthPending).toHaveBeenLastCalledWith({ clientId: 21, clientSecret: 22 });
    expect(result.current.oauthStatus).toEqual(activeStatus);
    expect(result.current.todoistConfigured).toBe(true);
    expect(result.current.credentialActionLocked).toBe(false);
  });

  it("refreshes the credential source after importing the environment pair", async () => {
    const environmentStatus = { ...activeStatus, application: { ...activeStatus.application, source: "environment" as const } };
    mockApi.getTodoistConnectionStatus.mockResolvedValueOnce(environmentStatus).mockResolvedValueOnce(activeStatus);
    mockApi.importTodoistOAuthEnvironment.mockResolvedValue({ credentials: [] });
    const { result } = renderHook(() => useTodoistSetup({ settings: { todoist_configured: true } }));
    await waitFor(() => expect(result.current.oauthStatus?.application.source).toBe("environment"));
    await act(async () => { await result.current.handleImportEnvironment(); });

    expect(result.current.oauthStatus?.application.source).toBe("stored");
    expect(result.current.oauthStatus?.mode).toBe("oauth");
    expect(result.current.todoistConfigured).toBe(true);
    expect(result.current.oauthBusy).toBe(false);
  });

  it("keeps the connection until an explicitly requested disconnect is confirmed", async () => {
    mockApi.getTodoistConnectionStatus.mockResolvedValue(activeStatus);
    const { result } = renderHook(() => useTodoistSetup({ settings: { todoist_configured: true } }));
    await waitFor(() => expect(result.current.oauthStatus?.configured).toBe(true));
    await act(async () => { await result.current.handleDisconnectTodoist(); });
    expect(result.current.todoistConfigured).toBe(true);
    expect(result.current.oauthStatus?.configured).toBe(true);

    act(() => result.current.requestDisconnect());
    expect(result.current.confirmingDisconnect).toBe(true);
    act(() => result.current.cancelDisconnect());
    await act(async () => { await result.current.handleDisconnectTodoist(); });
    expect(result.current.todoistConfigured).toBe(true);

    act(() => result.current.requestDisconnect());
    await act(async () => { await result.current.handleDisconnectTodoist(); });
    expect(result.current.confirmingDisconnect).toBe(false);
    expect(result.current.todoistConfigured).toBe(false);
    expect(result.current.oauthStatus).toMatchObject({ mode: "disconnected", configured: false, oauthRefreshable: false, needsReauth: false, deliveryMode: "periodic" });
  });

  it("retains disconnect confirmation while the authorized action waits for password step-up", async () => {
    mockApi.getTodoistConnectionStatus.mockResolvedValue(activeStatus);
    mockApi.disconnectTodoistConnection.mockRejectedValueOnce(passwordStepUpRequired());
    const { result } = renderHook(() => useTodoistSetup({ settings: { todoist_configured: true } }));
    await waitFor(() => expect(result.current.oauthStatus?.configured).toBe(true));
    act(() => result.current.requestDisconnect());
    await act(async () => { await result.current.handleDisconnectTodoist(); });

    expect(result.current.credentialActionLocked).toBe(true);
    expect(result.current.confirmingDisconnect).toBe(true);
    expect(result.current.todoistConfigured).toBe(true);
    await unlock(result);

    expect(result.current.todoistConfigured).toBe(false);
    expect(result.current.confirmingDisconnect).toBe(false);
    expect(result.current.credentialActionLocked).toBe(false);
  });
});
