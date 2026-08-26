import { useRef, useState } from "react";
import { Download, File, FileImage, FileSpreadsheet, FileText, Paperclip } from "lucide-react";
import { getEmailAttachmentUrl } from "../../../api";
import type { EmailBodyAttachment } from "../../../../shared/types/email";
import EmailAttachmentPreview from "./EmailAttachmentPreview";
import {
  emailAttachmentName,
  emailAttachmentPreviewKind,
  emailAttachmentTypeLabel,
  formatAttachmentSize,
  visibleEmailAttachments,
} from "./emailAttachmentModel";
import { downloadEmailAttachment } from "./emailAttachmentDownload";
import "./EmailAttachmentShelf.css";

export default function EmailAttachmentShelf({
  emailUid,
  attachments,
  isMobile = false,
}: {
  emailUid: string;
  attachments: EmailBodyAttachment[] | null | undefined;
  isMobile?: boolean;
}) {
  const visibleAttachments = visibleEmailAttachments(attachments);
  const [previewAttachment, setPreviewAttachment] = useState<EmailBodyAttachment | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const previewTriggerRef = useRef<HTMLButtonElement | null>(null);

  if (!emailUid || !visibleAttachments.length) return null;

  const closePreview = () => {
    setPreviewAttachment(null);
    window.requestAnimationFrame(() => previewTriggerRef.current?.focus());
  };

  return (
    <section
      className={`email-attachment-shelf${isMobile ? " email-attachment-shelf-mobile" : ""}`}
      aria-label={`${visibleAttachments.length} email attachment${visibleAttachments.length === 1 ? "" : "s"}`}
    >
      <div className="email-attachment-shelf-summary">
        <Paperclip size={13} aria-hidden="true" />
        <span>{visibleAttachments.length} attachment{visibleAttachments.length === 1 ? "" : "s"}</span>
      </div>
      <div className="email-attachment-shelf-scroll" tabIndex={visibleAttachments.length > 2 ? 0 : undefined}>
        {visibleAttachments.map((attachment) => {
          const previewKind = emailAttachmentPreviewKind(attachment.contentType);
          const filename = emailAttachmentName(attachment);
          const Icon = previewKind === "image"
            ? FileImage
            : previewKind === "pdf"
              ? FileText
              : previewKind === "csv"
                ? FileSpreadsheet
                : File;
          const downloadHref = getEmailAttachmentUrl(emailUid, attachment.id);
          return (
            <div
              className={`email-attachment-item${previewKind ? " email-attachment-item-previewable" : ""}`}
              key={attachment.id}
            >
              {previewKind ? (
                <button
                  type="button"
                  className="email-attachment-item-preview-trigger"
                  aria-label={`Preview ${filename}`}
                  title={`Preview ${filename}`}
                  onClick={(event) => {
                    previewTriggerRef.current = event.currentTarget;
                    setPreviewAttachment(attachment);
                  }}
                />
              ) : null}
              <div className="email-attachment-item-icon" aria-hidden="true">
                <Icon size={17} />
              </div>
              <div className="email-attachment-item-copy">
                <div className="email-attachment-item-name" title={filename}>{filename}</div>
                <div className="email-attachment-item-meta">
                  {emailAttachmentTypeLabel(attachment)} · {formatAttachmentSize(attachment.size)}
                </div>
              </div>
              <div className="email-attachment-item-actions">
                <a
                  href={downloadHref}
                  download={filename}
                  aria-label={`Download ${filename}`}
                  title={`Download ${filename}`}
                  onClick={(event) => {
                    event.preventDefault();
                    setDownloadError(null);
                    downloadEmailAttachment(emailUid, attachment).catch(() => {
                      setDownloadError(`Could not download ${filename}. Try again.`);
                    });
                  }}
                >
                  <Download size={14} aria-hidden="true" />
                </a>
              </div>
            </div>
          );
        })}
      </div>
      {downloadError ? <div className="email-attachment-shelf-error" role="alert">{downloadError}</div> : null}
      {previewAttachment ? (
        <EmailAttachmentPreview
          emailUid={emailUid}
          attachment={previewAttachment}
          onClose={closePreview}
        />
      ) : null}
    </section>
  );
}
