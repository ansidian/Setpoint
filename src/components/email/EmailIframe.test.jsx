import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import EmailIframe from "./EmailIframe.jsx";

afterEach(() => {
  cleanup();
});

// The srcDoc string is the deterministic output of the sanitize + tracking-pixel
// pass — assert on it directly rather than racing the iframe's document parsing.
function srcdocFor(html) {
  render(<EmailIframe html={html} />);
  return screen.getByTitle("Email content").getAttribute("srcdoc") || "";
}

describe("EmailIframe sanitization (security surface)", () => {
  it("strips <script> tags from untrusted email HTML", () => {
    const out = srcdocFor('<p>hello</p><script>window.__pwned = 1;</script>');
    expect(out).not.toMatch(/<script/i);
    expect(out).not.toContain("__pwned");
    expect(out).toContain("hello");
  });

  it("removes 1x1 and 0x0 tracking pixels but keeps real images", () => {
    const out = srcdocFor(
      '<img src="https://track.example/pixel.gif" width="1" height="1">'
        + '<img src="https://track.example/beacon.gif" height="0">'
        + '<img src="https://cdn.example/banner.png" width="600" height="200">',
    );
    expect(out).not.toContain("pixel.gif");
    expect(out).not.toContain("beacon.gif");
    expect(out).toContain("banner.png");
    expect(out).toContain('width="600"');
  });

  it("keeps width=100/height=150 images (digit-prefix is not a tracking pixel)", () => {
    const out = srcdocFor('<img src="https://cdn.example/wide.png" width="100" height="150">');
    expect(out).toContain("wide.png");
  });

  it("preserves email styling tags and allowlisted attributes", () => {
    const out = srcdocFor('<style>.a{color:red}</style><div class="a" bgcolor="#ffffff">body</div>');
    expect(out).toMatch(/<style/i);
    expect(out).toContain('class="a"');
    expect(out).toContain("body");
  });

  it("sandboxes the iframe without allow-scripts so embedded JS cannot execute", () => {
    render(<EmailIframe html="<p>x</p>" />);
    const sandbox = screen.getByTitle("Email content").getAttribute("sandbox") || "";
    expect(sandbox).not.toMatch(/allow-scripts/);
    expect(sandbox.split(/\s+/)).toEqual(
      expect.arrayContaining([
        "allow-same-origin",
        "allow-popups",
        "allow-popups-to-escape-sandbox",
      ]),
    );
  });
});

describe("EmailIframe reader-hotkey relay", () => {
  // The inbox/shell command listeners live on the parent window; relayed events
  // reach them via the window->document->window propagation of a parent-document
  // dispatch.
  function withParentKeyListener(run) {
    const received = [];
    const onParentKey = (event) => received.push(event.key);
    window.addEventListener("keydown", onParentKey);
    try {
      run(received);
    } finally {
      window.removeEventListener("keydown", onParentKey);
    }
  }

  // Alfred's Esc handler is a document-CAPTURE listener — the relay must reach it,
  // not just window listeners, for the preview to close from inside its iframe.
  function withDocumentCaptureListener(run) {
    const received = [];
    const onKey = (event) => received.push(event.key);
    document.addEventListener("keydown", onKey, true);
    try {
      run(received);
    } finally {
      document.removeEventListener("keydown", onKey, true);
    }
  }

  function loadedIframe(html = "<p>body</p>") {
    render(<EmailIframe html={html} />);
    const iframe = screen.getByTitle("Email content");
    fireEvent.load(iframe);
    return iframe;
  }

  it("relays shell tab keys and inbox command keys from the email document", () => {
    withParentKeyListener((received) => {
      const doc = loadedIframe("<p>Loaded email body</p>").contentDocument;
      for (const key of ["1", "2", "f", "d", "j", "o"]) {
        doc.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
      }
      expect(received).toEqual(["1", "2", "f", "d", "j", "o"]);
    });
  });

  it("relays Escape to a document-capture listener (Alfred preview close path)", () => {
    withDocumentCaptureListener((received) => {
      const doc = loadedIframe().contentDocument;
      doc.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
      expect(received).toEqual(["Escape"]);
    });
  });

  it("leaves scroll/native keys and modifier combos un-relayed", () => {
    withParentKeyListener((received) => {
      const doc = loadedIframe().contentDocument;
      doc.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
      doc.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));
      doc.dispatchEvent(new KeyboardEvent("keydown", { key: "3", bubbles: true }));
      doc.dispatchEvent(new KeyboardEvent("keydown", { key: "e", metaKey: true, bubbles: true }));
      doc.dispatchEvent(new KeyboardEvent("keydown", { key: "f", ctrlKey: true, bubbles: true }));
      doc.dispatchEvent(new KeyboardEvent("keydown", { key: "1", altKey: true, bubbles: true }));

      expect(received).toEqual([]);
    });
  });

  it("does not relay command keys typed into a form field inside the email", () => {
    withParentKeyListener((received) => {
      const doc = loadedIframe().contentDocument;
      const host = doc.body || doc.documentElement;
      const input = doc.createElement("input");
      host.appendChild(input);

      input.dispatchEvent(new KeyboardEvent("keydown", { key: "d", bubbles: true }));

      expect(received).toEqual([]);
    });
  });
});
