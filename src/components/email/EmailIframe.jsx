import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import DOMPurify from "dompurify";
import { shouldRelayReaderKey } from "./readerHotkeyRelay.js";
import { hasRemoteImageRefs } from "./remoteContentDetection.js";
import {
  REMOTE_IMAGES_ALLOWED_EMAIL_CSP_POLICY,
  STRICT_EMAIL_CSP_POLICY,
  withEmailContentSecurityPolicy,
  withMobileViewport,
} from "./withMobileViewport";

// Renders a sanitized email body inside an iframe. The iframe always fills
// its parent container's height (100%) — EmailReader provides a fixed-size
// scrollable region, and the iframe's own scrollbar handles overflow for
// long emails. Width is 100% so multi-column layouts can reflow.
export default function EmailIframe({ html, isMobile = false }) {
  const iframeRef = useRef(null);
  const hotkeyDocumentRef = useRef(null);

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

  // Per-message, session-only opt-in to load remote images. Resets to blocked
  // whenever a different email is opened (the `html` prop changes) — this is
  // deliberately one-way (no re-hide button): the browser has already fetched
  // the images by the time the user clicks, so re-blocking would be cosmetic
  // only, not a real privacy backstop.
  const [remoteContentAllowed, setRemoteContentAllowed] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- resetting per-message opt-in state when a new email (`html`) is opened; there is no external system to synchronize with here
    setRemoteContentAllowed(false);
  }, [html]);

  // eslint-disable-next-line react-hooks/preserve-manual-memoization -- the boolean-AND after the useMemo call defeats the compiler's ability to preserve this memoization; hasRemoteImageRefs is still only re-run when `sanitized` changes
  const showRemoteContentBanner = useMemo(() => hasRemoteImageRefs(sanitized), [sanitized])
    && !remoteContentAllowed;

  const policy = remoteContentAllowed ? REMOTE_IMAGES_ALLOWED_EMAIL_CSP_POLICY : STRICT_EMAIL_CSP_POLICY;
  const srcDoc = useMemo(
    () => withEmailContentSecurityPolicy(isMobile ? withMobileViewport(sanitized) : sanitized, policy),
    [isMobile, sanitized, policy],
  );

  // Keydowns inside the email document never bubble to the parent window, so the
  // inbox/shell/Alfred command listeners (all on the parent) would otherwise go
  // dead the moment focus enters the email. Re-dispatch the reader command keys
  // (see readerHotkeyRelay.js) onto the PARENT DOCUMENT — not window — so the
  // event propagates window->document->window and reaches both the window-level
  // listeners (inbox j/k/triage, shell 1/2) and Alfred's document-capture Esc
  // listener. Non-command keys (arrows/space/page, ⌘/Ctrl/Alt combos) are left
  // native so email scroll, copy, and find still work.
  const relayReaderHotkey = useCallback((event) => {
    const target = event.target;
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
      doc.querySelectorAll("a[href]").forEach((a) => {
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
      {showRemoteContentBanner && (
        // This banner sits on the email body's white backdrop, not the dark app
        // chrome, so its text/button colors below are literal hex/rgba, not --sp-* tokens.
        <div
          style={{
            margin: "0 0 8px",
            borderRadius: 8,
            padding: "8px 12px",
            background: "linear-gradient(135deg, color-mix(in srgb, var(--sp-blue) 6%, transparent), color-mix(in srgb, var(--sp-blue) 2%, transparent))",
            border: "1px dashed color-mix(in srgb, var(--sp-blue) 28%, transparent)",
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 10,
            flexShrink: 0,
          }}
        >
          <span style={{ fontSize: 11.5, color: "#475569" }}>
            Images are blocked in this email to protect your privacy.
          </span>
          <button
            type="button"
            onClick={() => setRemoteContentAllowed(true)}
            style={{
              flexShrink: 0,
              padding: "4px 10px",
              borderRadius: 6,
              fontSize: 11,
              fontWeight: 600,
              fontFamily: "inherit",
              color: "#1d4ed8",
              background: "rgba(29, 78, 216, 0.08)",
              border: "1px solid rgba(29, 78, 216, 0.3)",
              cursor: "pointer",
            }}
          >
            Show remote content
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
