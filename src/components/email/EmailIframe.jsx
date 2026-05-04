import { useCallback, useEffect, useRef } from "react";
import DOMPurify from "dompurify";

// Renders a sanitized email body inside an iframe. The iframe always fills
// its parent container's height (100%) — EmailReader provides a fixed-size
// scrollable region, and the iframe's own scrollbar handles overflow for
// long emails. Width is 100% so multi-column layouts can reflow.
export default function EmailIframe({ html }) {
  const iframeRef = useRef(null);
  const hotkeyDocumentRef = useRef(null);

  // Sanitize then wrap in a full document so the email's own styles apply
  const sanitized = DOMPurify.sanitize(html, {
    ADD_TAGS: ["style", "link", "meta", "img", "center"],
    ADD_ATTR: ["src", "alt", "width", "height", "style", "class", "align", "valign", "bgcolor", "cellpadding", "cellspacing", "border", "role"],
    FORBID_TAGS: ["script"],
    WHOLE_DOCUMENT: true,
  })
    // Strip tracking pixels (1x1 or 0x0 images). The digit must be the whole
    // value — not a prefix — otherwise width="100" / height="150" get eaten.
    .replace(/<img[^>]*(?:width\s*=\s*["']?[01]["'\s/>]|height\s*=\s*["']?[01]["'\s/>])[^>]*\/?>/gi, "");

  // Force every link to open in a new tab. Without this, anchors (especially
  // those with author-set target="_self"/"_top") navigate the iframe itself
  // to a blank page since the sandbox blocks top-navigation.
  const relayShellTabHotkey = useCallback((event) => {
    const target = event.target;
    if (
      target?.tagName === "INPUT"
      || target?.tagName === "TEXTAREA"
      || target?.isContentEditable
      || event.metaKey
      || event.ctrlKey
      || event.altKey
      || (event.key !== "1" && event.key !== "2")
    ) {
      return;
    }

    const relayed = new KeyboardEvent("keydown", {
      key: event.key,
      code: event.code,
      bubbles: true,
      cancelable: true,
      shiftKey: event.shiftKey,
    });
    window.parent?.dispatchEvent(relayed);
    if (relayed.defaultPrevented) event.preventDefault();
  }, []);

  useEffect(() => () => {
    hotkeyDocumentRef.current?.removeEventListener("keydown", relayShellTabHotkey);
  }, [relayShellTabHotkey]);

  const handleLoad = useCallback(() => {
    try {
      const doc = iframeRef.current?.contentDocument;
      if (!doc) return;
      doc.querySelectorAll("a[href]").forEach((a) => {
        a.target = "_blank";
        a.rel = "noopener noreferrer";
      });
      if (hotkeyDocumentRef.current && hotkeyDocumentRef.current !== doc) {
        hotkeyDocumentRef.current.removeEventListener("keydown", relayShellTabHotkey);
      }
      doc.removeEventListener("keydown", relayShellTabHotkey);
      doc.addEventListener("keydown", relayShellTabHotkey);
      hotkeyDocumentRef.current = doc;
    } catch {
      // contentDocument may be inaccessible in edge cases; silently skip
    }
  }, [relayShellTabHotkey]);

  return (
    <iframe
      ref={iframeRef}
      className="w-full h-full border-none rounded-default bg-white"
      sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
      srcDoc={sanitized}
      title="Email content"
      onLoad={handleLoad}
    />
  );
}
