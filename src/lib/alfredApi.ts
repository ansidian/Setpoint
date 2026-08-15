import { isDemoMode } from "../demo/config.ts";
import { apiFetch } from "./apiFetch";
import { readSseStream } from "./sseStream";
import type {
  AlfredConversationDeleteResponse,
  AlfredCalendarProposalCreatedResponse,
  AlfredEmailContextSource,
  AlfredPreparedEmailContext,
  AlfredRunEvent,
  AlfredStreamOptions,
} from "../../shared/types/alfred.ts";

type SignalOptions = { signal?: AbortSignal };

function responseErrorMessage(value: unknown): string | null {
  if (!value || typeof value !== "object" || !("message" in value) || !value.message) return null;
  return String(value.message);
}

export const prepareAlfredEmailContext = (
  source: AlfredEmailContextSource,
  { signal }: SignalOptions = {},
): Promise<AlfredPreparedEmailContext> => apiFetch("/api/alfred/email-context", {
  method: "POST",
  body: JSON.stringify({
    uid: source.uid,
    subject: source.subject,
    senderName: source.senderName,
    senderAddress: source.senderAddress,
    timestamp: source.timestamp,
  }),
  signal,
});

export const releaseAlfredEmailContext = (contextId: string): Promise<{ ok: true }> => (
  apiFetch(`/api/alfred/email-context/${encodeURIComponent(contextId)}`, { method: "DELETE" })
);

export async function runAlfredStream({ message, conversationId, emailContextId, createdProposalIds = [], signal, onEvent }: AlfredStreamOptions): Promise<void> {
  if (isDemoMode()) throw new Error("Alfred is not available in the demo");
  const res = await fetch("/api/alfred/run", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Requested-With": "Setpoint" },
    body: JSON.stringify({
      message,
      ...(conversationId ? { conversationId } : {}),
      ...(emailContextId ? { emailContextId } : {}),
      ...(createdProposalIds.length ? { createdProposalIds } : {}),
    }),
    ...(signal ? { signal } : {}),
  });
  if (res.status === 401) {
    window.location.href = "/login";
    throw new Error("Not authenticated");
  }
  if (!res.ok) {
    const body: unknown = await res.json().catch(() => null);
    const error = new Error(responseErrorMessage(body) || `API error: ${res.status}`) as Error & { code?: unknown; status?: number };
    error.code = body && typeof body === "object" && "code" in body ? body.code : null;
    error.status = res.status;
    throw error;
  }
  await readSseStream(res.body as ReadableStream<Uint8Array>, (payload) => onEvent(payload as AlfredRunEvent));
}

export const deleteAlfredConversation = (id: string | number): Promise<AlfredConversationDeleteResponse> => (
  apiFetch(`/api/alfred/conversations/${encodeURIComponent(id)}`, { method: "DELETE" })
);

export const acknowledgeAlfredCalendarProposalCreated = (
  conversationId: string,
  proposalId: string,
): Promise<AlfredCalendarProposalCreatedResponse> => {
  if (isDemoMode()) return Promise.reject(new Error("Alfred is not available in the demo"));
  return apiFetch(
    `/api/alfred/conversations/${encodeURIComponent(conversationId)}/proposals/${encodeURIComponent(proposalId)}/created`,
    { method: "POST", body: "{}" },
  );
};
