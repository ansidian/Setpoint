import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { motion as Motion, useReducedMotion } from "motion/react";
import { Download, FileWarning, RotateCcw, X } from "lucide-react";
import { fetchEmailAttachmentBlob, getEmailAttachmentUrl } from "../../../api";
import type { EmailBodyAttachment } from "../../../../shared/types/email";
import {
  emailAttachmentName,
  emailAttachmentPreviewKind,
  formatAttachmentSize,
} from "./emailAttachmentModel";
import { downloadEmailAttachment } from "./emailAttachmentDownload";
import EmailCsvPreview, { EMAIL_CSV_PREVIEW_MAX_BYTES } from "./EmailCsvPreview";
import EmailImagePreview from "./EmailImagePreview";
import EmailPdfPreview from "./EmailPdfPreview";

export default function EmailAttachmentPreview({
  emailUid,
  attachment,
  onClose,
}: {
  emailUid: string;
  attachment: EmailBodyAttachment;
  onClose: () => void;
}) {
  const reduceMotion = useReducedMotion() ?? false;
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const [retryKey, setRetryKey] = useState(0);
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [previewBlob, setPreviewBlob] = useState<Blob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const previewKind = emailAttachmentPreviewKind(attachment.contentType);
  const filename = emailAttachmentName(attachment);
  const previewLimitError = previewKind === "csv"
    && attachment.size != null
    && attachment.size > EMAIL_CSV_PREVIEW_MAX_BYTES
    ? "This CSV is larger than 5 MB. Download it to view the full file."
    : null;

  useEffect(() => {
    closeButtonRef.current?.focus();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let createdUrl: string | null = null;

    if (previewLimitError) return () => controller.abort();

    fetchEmailAttachmentBlob(emailUid, attachment.id, controller.signal)
      .then((blob) => {
        if (controller.signal.aborted) return;
        const actualKind = emailAttachmentPreviewKind(blob.type);
        if (!previewKind || actualKind !== previewKind) {
          throw new Error("This file type cannot be previewed safely.");
        }
        if (actualKind === "csv") {
          setPreviewBlob(blob);
        } else {
          createdUrl = URL.createObjectURL(blob);
          setObjectUrl(createdUrl);
        }
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setError(cause instanceof Error && cause.message
          ? cause.message
          : "Preview unavailable. Download the file or try again.");
      });

    return () => {
      controller.abort();
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [attachment.id, emailUid, previewKind, previewLimitError, retryKey]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const dialog = closeButtonRef.current?.closest<HTMLElement>("[role='dialog']");
      const controls = dialog
        ? [...dialog.querySelectorAll<HTMLElement>("button:not(:disabled), a[href]")]
        : [];
      if (controls.length < 2) return;
      const first = controls[0]!;
      const last = controls[controls.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, [onClose]);

  const downloadHref = getEmailAttachmentUrl(emailUid, attachment.id);

  return createPortal(
    <Motion.div
      className="email-attachment-preview-backdrop"
      initial={reduceMotion ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: reduceMotion ? 0 : 0.16 }}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <Motion.section
        role="dialog"
        aria-modal="true"
        aria-labelledby="email-attachment-preview-title"
        data-suspend-calendar-hotkeys="blocking"
        className="email-attachment-preview-dialog"
        initial={reduceMotion ? false : { opacity: 0, y: 12, scale: 0.985 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 8, scale: 0.99 }}
        transition={{ duration: reduceMotion ? 0 : 0.2, ease: [0.22, 1, 0.36, 1] }}
      >
        <header className="email-attachment-preview-header">
          <div className="email-attachment-preview-heading">
            <h2 id="email-attachment-preview-title" title={filename}>{filename}</h2>
            <p>{formatAttachmentSize(attachment.size)}</p>
          </div>
          <div className="email-attachment-preview-actions">
            <a
              className="email-attachment-preview-download"
              href={downloadHref}
              download={filename}
              onClick={(event) => {
                event.preventDefault();
                setDownloadError(null);
                downloadEmailAttachment(emailUid, attachment).catch(() => {
                  setDownloadError("Download unavailable. Try again.");
                });
              }}
            >
              <Download size={15} aria-hidden="true" />
              <span>Download</span>
            </a>
            <button
              ref={closeButtonRef}
              type="button"
              className="email-attachment-preview-close"
              aria-label="Close attachment preview"
              title="Close (Esc)"
              onClick={onClose}
            >
              <X size={17} aria-hidden="true" />
            </button>
          </div>
        </header>

        {downloadError ? <div className="email-attachment-preview-alert" role="alert">{downloadError}</div> : null}

        <div className="email-attachment-preview-content">
          {previewLimitError ? (
            <div className="email-attachment-preview-state email-attachment-preview-error" role="alert">
              <FileWarning size={26} aria-hidden="true" />
              <strong>CSV preview unavailable</strong>
              <span>{previewLimitError}</span>
            </div>
          ) : null}
          {!objectUrl && !previewBlob && !error && !previewLimitError ? (
            <div className="email-attachment-preview-state" role="status">
              <span className="email-attachment-preview-spinner" aria-hidden="true" />
              <span>Preparing preview…</span>
            </div>
          ) : null}
          {error && !previewLimitError ? (
            <div className="email-attachment-preview-state email-attachment-preview-error" role="alert">
              <FileWarning size={26} aria-hidden="true" />
              <strong>Preview unavailable</strong>
              <span>{error}</span>
              <button
                type="button"
                onClick={() => {
                  setError(null);
                  setRetryKey((value) => value + 1);
                }}
              >
                <RotateCcw size={14} aria-hidden="true" />
                Try again
              </button>
            </div>
          ) : null}
          {objectUrl && !error && !previewLimitError && previewKind === "image" ? (
            <EmailImagePreview
              objectUrl={objectUrl}
              filename={filename}
              onError={() => setError("This image could not be rendered. Download it to view the original file.")}
            />
          ) : null}
          {objectUrl && !error && !previewLimitError && previewKind === "pdf" ? (
            <EmailPdfPreview objectUrl={objectUrl} filename={filename} />
          ) : null}
          {previewBlob && !error && !previewLimitError && previewKind === "csv" ? (
            <EmailCsvPreview blob={previewBlob} filename={filename} />
          ) : null}
        </div>
      </Motion.section>
    </Motion.div>,
    document.body,
  );
}
