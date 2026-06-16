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

describe("EmailIframe shell-hotkey relay", () => {
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

  it("passes shell tab hotkeys (1/2) through from the email document", () => {
    withParentKeyListener((received) => {
      render(<EmailIframe html="<p>Loaded email body</p>" />);
      const iframe = screen.getByTitle("Email content");
      fireEvent.load(iframe);

      for (const key of ["1", "2"]) {
        iframe.contentDocument.dispatchEvent(
          new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
        );
      }

      expect(received).toEqual(["1", "2"]);
    });
  });

  it("does not relay non-shell keys or modifier combos", () => {
    withParentKeyListener((received) => {
      render(<EmailIframe html="<p>body</p>" />);
      const iframe = screen.getByTitle("Email content");
      fireEvent.load(iframe);
      const doc = iframe.contentDocument;

      doc.dispatchEvent(new KeyboardEvent("keydown", { key: "3", bubbles: true }));
      doc.dispatchEvent(new KeyboardEvent("keydown", { key: "1", metaKey: true, bubbles: true }));
      doc.dispatchEvent(new KeyboardEvent("keydown", { key: "2", ctrlKey: true, bubbles: true }));
      doc.dispatchEvent(new KeyboardEvent("keydown", { key: "1", altKey: true, bubbles: true }));

      expect(received).toEqual([]);
    });
  });

  it("does not relay shell hotkeys typed into a form field inside the email", () => {
    withParentKeyListener((received) => {
      render(<EmailIframe html="<p>body</p>" />);
      const iframe = screen.getByTitle("Email content");
      fireEvent.load(iframe);
      const doc = iframe.contentDocument;
      const host = doc.body || doc.documentElement;
      const input = doc.createElement("input");
      host.appendChild(input);

      input.dispatchEvent(new KeyboardEvent("keydown", { key: "1", bubbles: true }));

      expect(received).toEqual([]);
    });
  });
});
