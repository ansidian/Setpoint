import { useCallback, useEffect, useMemo, useRef } from "react";
import DOMPurify from "dompurify";
import { shouldRelayReaderKey } from "./readerHotkeyRelay.js";
import { withMobileViewport } from "./withMobileViewport";

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
    ADD_TAGS: ["style", "link", "meta", "img", "center"],
    ADD_ATTR: ["src", "alt", "width", "height", "style", "class", "align", "valign", "bgcolor", "cellpadding", "cellspacing", "border", "role"],
    FORBID_TAGS: ["script"],
    WHOLE_DOCUMENT: true,
  })
    // Strip tracking pixels (1x1 or 0x0 images). The digit must be the whole
    // value — not a prefix — otherwise width="100" / height="150" get eaten.
    .replace(/<img[^>]*(?:width\s*=\s*["']?[01]["'\s/>]|height\s*=\s*["']?[01]["'\s/>])[^>]*\/?>/gi, ""), [html]);

  const srcDoc = useMemo(
    () => (isMobile ? withMobileViewport(sanitized) : sanitized),
    [isMobile, sanitized],
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
    <iframe
      ref={iframeRef}
      className="w-full h-full border-none rounded-default bg-white"
      sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
      srcDoc={srcDoc}
      title="Email content"
      onLoad={handleLoad}
    />
  );
}
