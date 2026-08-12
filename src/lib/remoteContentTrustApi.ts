import type {
  RemoteContentTrustEntry,
  RemoteContentTrustMutationResponse,
} from "../../shared/types/email.ts";
import { apiFetch } from "./apiFetch";

export const getRemoteContentTrust = (): Promise<RemoteContentTrustEntry[]> =>
  apiFetch("/api/briefing/email/remote-content-trust");

export const trustRemoteContentSender = (
  accountId: string,
  senderAddress: string,
): Promise<RemoteContentTrustMutationResponse> => apiFetch(
  "/api/briefing/email/remote-content-trust",
  {
    method: "POST",
    body: JSON.stringify({ account_id: accountId, sender_address: senderAddress }),
  },
);

export const removeRemoteContentTrust = (
  id: string | number,
): Promise<RemoteContentTrustMutationResponse> =>
  apiFetch(`/api/briefing/email/remote-content-trust/${encodeURIComponent(id)}`, { method: "DELETE" });
