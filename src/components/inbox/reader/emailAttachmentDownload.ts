import { fetchEmailAttachmentBlob } from "../../../api";
import type { EmailBodyAttachment } from "../../../../shared/types/email";
import { emailAttachmentName } from "./emailAttachmentModel";

export async function downloadEmailAttachment(
  emailUid: string,
  attachment: EmailBodyAttachment,
): Promise<void> {
  const blob = await fetchEmailAttachmentBlob(emailUid, attachment.id);
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = emailAttachmentName(attachment);
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
}
