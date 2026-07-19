import { apiFetch } from "./apiFetch";
import type {
  GmailPubSubCallbackResponse,
  GmailPubSubStatus,
  GmailPubSubWatchTestResponse,
} from "../../shared/types/email";

const BASE = "/api/instance-credentials/gmail-pubsub";

export const getGmailPubSubStatus = (): Promise<GmailPubSubStatus> => apiFetch(BASE);
export const setGmailPubSubTopic = (value: string): Promise<unknown> => apiFetch(`${BASE}/topic`, {
  method: "PUT",
  body: JSON.stringify({ value }),
});
export const generateGmailPubSubCallback = (): Promise<GmailPubSubCallbackResponse> => apiFetch(`${BASE}/generate-callback`, { method: "POST" });
export const importGmailPubSubEnvironmentToken = (): Promise<GmailPubSubStatus> => apiFetch(`${BASE}/import-environment-token`, { method: "POST" });
export const revokeGmailPubSubToken = (): Promise<GmailPubSubStatus> => apiFetch(`${BASE}/revoke-token`, { method: "POST" });
export const testGmailPubSubWatches = (): Promise<GmailPubSubWatchTestResponse> => apiFetch(`${BASE}/test-watches`, { method: "POST" });
