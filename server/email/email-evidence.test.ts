import { describe, expect, it } from "vitest";
import { boundEmailEvidence, emailEvidenceText, EMAIL_EVIDENCE_CHAR_LIMIT, EMAIL_EVIDENCE_TRUNCATED, requireCompleteEmailEvidence } from "./email-evidence.ts";

describe("email evidence", () => {
  it("preserves balance columns and rows instead of associating the next value with the last label", () => {
    const text = emailEvidenceText('<table><tr><th>Plan adjusted balance</th><th>Remaining statement balance</th></tr><tr><td>$0.00</td><td>$472.32</td></tr></table>');
    const lines = text.split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]!.indexOf("Remaining")).toBe(lines[1]!.indexOf("$472.32"));
    expect(lines[0]!.indexOf("Plan")).toBe(lines[1]!.indexOf("$0.00"));
  });

  it("preserves nested table amounts, paragraphs and list items", () => {
    const text = emailEvidenceText('<table><tr><td><p>Your payment</p><table><tr><td>Statement balance</td><td>$472.32</td></tr></table><ul><li>Due September 10</li><li>Autopay on</li></ul></td></tr></table>');
    expect(text).toContain("Statement balance");
    expect(text).toContain("$472.32");
    expect(text).toMatch(/Due September 10\n/);
    expect(text).toContain("Autopay on");
  });

  it("excludes hidden table columns without introducing an apparent zero balance", () => {
    const text = emailEvidenceText('<table><tr><td style="display: none">Plan balance</td><td>Statement balance</td></tr><tr><td hidden>$0.00</td><td>$472.32</td></tr></table>');
    expect(text).toBe("Statement balance\n$472.32");
  });

  it("handles inline visibility consistently regardless of CSS spacing or case", () => {
    const text = emailEvidenceText('<div style="DISPLAY : none !important">Wrong cancellation</div><p aria-hidden="TRUE">Wrong balance</p><p style="color: red">Balance $472.32</p>');
    expect(text).toBe("Balance $472.32");
  });

  it("removes hidden noise and tracking parameters before budgeting without dropping surrounding content", () => {
    const text = emailEvidenceText(`<p>Review <a href="https://bank.test/pay?utm_source=email&upn=${"x".repeat(4000)}&invoice=123">your payment</a>.</p><div hidden>Wrong balance $0.00</div><p>Remaining statement balance $472.32</p>`);
    expect(text).toContain("https://bank.test/pay?invoice=123");
    expect(text).not.toContain("Wrong balance");
    expect(text).not.toContain("utm_source");
    expect(text).toContain("Remaining statement balance $472.32");
    expect(text.length).toBeLessThan(200);
  });

  it("keeps plain-text newlines, comparison symbols and forwarded context", () => {
    const text = "Amount < $500\nRemaining statement balance: $472.32\n\nForwarded message:\nPayment cancelled";
    expect(emailEvidenceText(text, "text")).toBe(text);
  });

  it("preserves image descriptions without sending image payloads or tracking URLs as text evidence", () => {
    const text = emailEvidenceText(`<p>Receipt</p><img alt="Payment receipt" src="data:image/png;base64,${"x".repeat(4000)}"><img src="https://tracking.test/pixel?customer=123">`);
    expect(text).toContain("[Image omitted: Payment receipt]");
    expect(text).not.toContain("base64");
    expect(text).not.toContain("tracking.test");
  });

  it("provides whole decision evidence beyond the former prefix and fails explicitly on incomplete storage", () => {
    const text = `${"Earlier context. ".repeat(300)}\nPayment cancelled; do not pay $472.32.`;
    expect(requireCompleteEmailEvidence(text)).toContain("Payment cancelled; do not pay $472.32.");
    const bounded = boundEmailEvidence("x".repeat(EMAIL_EVIDENCE_CHAR_LIMIT + 1));
    expect(bounded.length).toBe(EMAIL_EVIDENCE_CHAR_LIMIT);
    expect(bounded).toContain(EMAIL_EVIDENCE_TRUNCATED);
    expect(() => requireCompleteEmailEvidence(bounded)).toThrow(/Complete email evidence/);
    expect(() => requireCompleteEmailEvidence("x".repeat(EMAIL_EVIDENCE_CHAR_LIMIT + 1))).toThrow(/Complete email evidence/);
  });
});
