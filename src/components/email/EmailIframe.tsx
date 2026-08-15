import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import DOMPurify from "dompurify";
import { shouldRelayReaderKey } from "./readerHotkeyRelay";
import { hasRemoteImageRefs } from "./remoteContentDetection";
import {
  REMOTE_IMAGES_ALLOWED_EMAIL_CSP_POLICY,
  STRICT_EMAIL_CSP_POLICY,
  withEmailContentSecurityPolicy,
  withMobileViewport,
} from "./withMobileViewport";

export interface EmailIframeRemoteContentTrust {
  status: "loading" | "trusted" | "untrusted";
  senderAddress?: string | null;
  onTrustSender?: (() => Promise<void>) | null;
}

// Renders a sanitized email body inside an iframe. The iframe always fills
// its parent container's height (100%) — EmailReader provides a fixed-size
// scrollable region, and the iframe's own scrollbar handles overflow for
// long emails. Width is 100% so multi-column layouts can reflow.
export default function EmailIframe({ html, isMobile = false, messageKey, remoteContentTrust }: {
  html: string;
  isMobile?: boolean;
  messageKey?: string | null;
  remoteContentTrust?: EmailIframeRemoteContentTrust;
}) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const hotkeyDocumentRef = useRef<Document | null>(null);

  // Sanitize then wrap in a full document so the email's own styles apply.
  // Memoized on `html` only — the DOMPurify config and tracking-pixel regex are
  // static literals — so reader-chrome state changes (bill panel, draft, snooze
  // picker, bill-resolver completion) re-render without re-running the whole-
  // document sanitize + regex scan over an unchanged body.
  const sanitized = useMemo(() => DOMPurify.sanitize(html, {
    ADD_TAGS: ["style", "meta", "img", "center"],
    ADD_ATTR: ["src", "alt", "width", "height", "style", "class", "align", "valign", "bgcolor", "cellpadding", "cellspacing", "border", "role"],
    FORBID_TAGS: ["script", "link", "form", "input", "button", "textarea", "select"],
    WHOLE_DOCUMENT: true,
  })
    // Strip tracking pixels (1x1 or 0x0 images). The digit must be the whole
    // value — not a prefix — otherwise width="100" / height="150" get eaten.
    .replace(/<img[^>]*(?:width\s*=\s*["']?[01]["'\s/>]|height\s*=\s*["']?[01]["'\s/>])[^>]*\/?>/gi, ""), [html]);

  // Track the message identity that received a one-time grant. Comparing the
  // current key resets the grant naturally when another message opens without
  // a state-reset effect, even when two template emails have identical HTML.
  // Re-blocking after a fetch would only be cosmetic, so the one-time action
  // remains one-way for the open message.
  const contentKey = messageKey || html;
  const [allowedContentKey, setAllowedContentKey] = useState<string | null>(null);
  const [savedContentKey, setSavedContentKey] = useState<string | null>(null);
  const [savingContentKey, setSavingContentKey] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<{ contentKey: string; message: string } | null>(null);
  const trustStatus = remoteContentTrust?.status || "untrusted";
  const shownOnce = allowedContentKey === contentKey;
  const remoteContentAllowed = trustStatus === "trusted" || shownOnce || savedContentKey === contentKey;

  const hasRemoteContent = useMemo(() => hasRemoteImageRefs(sanitized), [sanitized]);
  const canTrustSender = Boolean(remoteContentTrust?.senderAddress && remoteContentTrust?.onTrustSender);
  const showBlockedBanner = hasRemoteContent && trustStatus !== "loading" && !remoteContentAllowed;
  const showTrustConfirmation = hasRemoteContent && shownOnce && savedContentKey !== contentKey && canTrustSender;

  const policy = remoteContentAllowed ? REMOTE_IMAGES_ALLOWED_EMAIL_CSP_POLICY : STRICT_EMAIL_CSP_POLICY;
  const srcDoc = useMemo(
    () => withEmailContentSecurityPolicy(isMobile ? withMobileViewport(sanitized) : sanitized, policy),
    [isMobile, sanitized, policy],
  );

  // Keydowns inside the email document never bubble to the parent window, so the
  // inbox/shell/Alfred command listeners (all on the parent) would otherwise go
  // dead the moment focus enters the email. Re-dispatch the reader command keys
  // (see readerHotkeyRelay.ts) onto the PARENT DOCUMENT — not window — so the
  // event propagates window->document->window and reaches both the window-level
  // listeners (inbox j/k/triage, shell 1/2) and Alfred's document-capture Esc
  // listener. Non-command keys (arrows/space/page and ordinary modifier combos)
  // are left native so email scroll, copy, and find still work; Alfred's global
  // Cmd/Ctrl+Backslash toggle is the one admitted modifier chord.
  const relayReaderHotkey = useCallback((event: KeyboardEvent) => {
    // Avoid `instanceof HTMLElement`: iframe elements belong to a different
    // realm, so that check rejects real inputs/textareas from the email document.
    const target = event.target as HTMLElement | null;
    if (!shouldRelayReaderKey({
      key: event.key,
      metaKey: event.metaKey,
      ctrlKey: event.ctrlKey,
      altKey: event.altKey,
      targetTag: target?.tagName,
      isContentEditable: target?.isContentEditable,
    })) {
      return;
    }

    const relayed = new KeyboardEvent("keydown", {
      key: event.key,
      code: event.code,
      bubbles: true,
      cancelable: true,
      shiftKey: event.shiftKey,
      metaKey: event.metaKey,
      ctrlKey: event.ctrlKey,
      altKey: event.altKey,
    });
    const parentDocument = window.parent?.document;
    if (!parentDocument) return;
    parentDocument.dispatchEvent(relayed);
    if (relayed.defaultPrevented) event.preventDefault();
  }, []);

  useEffect(() => () => {
    hotkeyDocumentRef.current?.removeEventListener("keydown", relayReaderHotkey);
  }, [relayReaderHotkey]);

  const handleLoad = useCallback(() => {
    try {
      const doc = iframeRef.current?.contentDocument;
      if (!doc) return;
      doc.querySelectorAll<HTMLAnchorElement>("a[href]").forEach((a) => {
        a.target = "_blank";
        a.rel = "noopener noreferrer";
      });
      if (hotkeyDocumentRef.current && hotkeyDocumentRef.current !== doc) {
        hotkeyDocumentRef.current.removeEventListener("keydown", relayReaderHotkey);
      }
      doc.removeEventListener("keydown", relayReaderHotkey);
      doc.addEventListener("keydown", relayReaderHotkey);
      hotkeyDocumentRef.current = doc;
    } catch {
      // contentDocument may be inaccessible in edge cases; silently skip
    }
  }, [relayReaderHotkey]);

  return (
    <div className="w-full h-full flex flex-col min-h-0">
      {(showBlockedBanner || showTrustConfirmation) && (
        // This banner sits on the email body's white backdrop, not the dark app
        // chrome, so its text/button colors below are literal hex/rgba, not --sp-* tokens.
        <div
          aria-live="polite"
          style={{
            margin: "0 0 8px",
            borderRadius: 8,
            padding: "8px 12px",
            background: showTrustConfirmation
              ? "rgba(15, 23, 42, 0.035)"
              : "linear-gradient(135deg, color-mix(in srgb, var(--sp-blue) 6%, transparent), color-mix(in srgb, var(--sp-blue) 2%, transparent))",
            border: showTrustConfirmation
              ? "1px solid rgba(71, 85, 105, 0.16)"
              : "1px dashed color-mix(in srgb, var(--sp-blue) 28%, transparent)",
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 10,
            flexShrink: 0,
            transition: "background-color var(--sp-motion-fast) var(--sp-ease-out), border-color var(--sp-motion-fast) var(--sp-ease-out)",
          }}
        >
          <div style={{ minWidth: 0, flex: "1 1 220px" }}>
            <span style={{ fontSize: 11.5, color: "#475569" }}>
              {showTrustConfirmation
                ? "Remote content is shown for this message."
                : "Images are blocked in this email to protect your privacy."}
            </span>
            {saveError?.contentKey === contentKey ? (
              <div role="alert" style={{ marginTop: 3, fontSize: 10.5, color: "#be123c" }}>
                {saveError.message}
              </div>
            ) : null}
          </div>
          <button
            type="button"
            disabled={savingContentKey === contentKey}
            onClick={() => {
              if (!showTrustConfirmation) {
                setAllowedContentKey(contentKey);
                setSaveError(null);
                return;
              }
              const trustSender = remoteContentTrust?.onTrustSender;
              if (!trustSender) return;
              setSavingContentKey(contentKey);
              setSaveError(null);
              trustSender()
                .then(() => setSavedContentKey(contentKey))
                .catch((error: unknown) => {
                  setSaveError({
                    contentKey,
                    message: error instanceof Error && error.message
                      ? error.message
                      : "Could not save this trusted sender. Try again.",
                  });
                })
                .finally(() => setSavingContentKey((current) => current === contentKey ? null : current));
            }}
            className="max-w-full shrink-0 rounded-md border border-[rgba(29,78,216,0.3)] bg-[rgba(29,78,216,0.08)] text-[#1d4ed8] transition-[background-color,border-color,color,transform] duration-150 hover:-translate-y-px hover:border-[#1d4ed8]/50 hover:bg-[#1d4ed8]/[0.13] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563eb]/55 focus-visible:ring-offset-1 focus-visible:ring-offset-white active:translate-y-0 disabled:cursor-wait disabled:opacity-60 motion-reduce:transform-none motion-reduce:transition-none"
            style={{
              padding: "4px 10px",
              fontSize: 11,
              fontWeight: 600,
              fontFamily: "inherit",
              cursor: savingContentKey === contentKey ? "wait" : "pointer",
              overflowWrap: "anywhere",
            }}
          >
            {savingContentKey === contentKey
              ? "Saving…"
              : showTrustConfirmation
                ? `Always show from ${remoteContentTrust?.senderAddress}`
                : "Show once"}
          </button>
        </div>
      )}
      <iframe
        ref={iframeRef}
        className="w-full flex-1 border-none rounded-default bg-white"
        sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
        srcDoc={srcDoc}
        title="Email content"
        onLoad={handleLoad}
      />
    </div>
  );
}
