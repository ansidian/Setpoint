import { isDemoMode } from "../demo/config.ts";

export const getEmailAttachmentUrl = (uid: string, attachmentId: string): string => (
  `/api/briefing/email/${encodeURIComponent(uid)}/attachments/${encodeURIComponent(attachmentId)}`
);

export async function fetchEmailAttachmentBlob(
  uid: string,
  attachmentId: string,
  signal?: AbortSignal,
): Promise<Blob> {
  if (isDemoMode()) {
    const demo = await import("../demo/emailAttachments.ts");
    return demo.getDemoEmailAttachmentBlob(uid, attachmentId);
  }

  const response = await fetch(getEmailAttachmentUrl(uid, attachmentId), {
    signal,
    headers: { "X-Requested-With": "Setpoint" },
  });
  if (response.status === 401) {
    window.location.href = "/login";
    throw new Error("Not authenticated");
  }
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    const message = typeof body === "object" && body !== null && "message" in body
      ? String(body.message)
      : null;
    throw new Error(message || `Attachment download failed: ${response.status}`);
  }
  return response.blob();
}
