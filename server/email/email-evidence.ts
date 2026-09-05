import { compile, type DomNode } from "html-to-text";

export const EMAIL_EVIDENCE_CHAR_LIMIT = 20_000;
export const EMAIL_EVIDENCE_TRUNCATED = "[Email evidence truncated: the complete message is not available.]";
const RAW_EMAIL_CHAR_LIMIT = 2_000_000;

function compactUrl(raw: string): string {
  try {
    const url = new URL(raw);
    for (const [key, value] of [...url.searchParams]) {
      if (/^(utm_|fbclid$|gclid$|mc_|upn$)/i.test(key) || value.length > 80) {
        url.searchParams.delete(key);
      }
    }
    url.hash = "";
    return url.toString();
  } catch {
    return raw;
  }
}

function compactTextUrls(text: string): string {
  return text.replace(/https?:\/\/[^\s<>"']+/gi, (match) => {
    const suffix = match.match(/[),.;]+$/)?.[0] || "";
    return compactUrl(suffix ? match.slice(0, -suffix.length) : match) + suffix;
  });
}

function isHidden(node: DomNode): boolean {
  const attrs = node.attribs || {};
  return "hidden" in attrs || String(attrs["aria-hidden"]).toLowerCase() === "true"
    || /(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*hidden)\b/i.test(attrs.style || "");
}

function visibleTableContent(node: DomNode): DomNode {
  // The library's data-table formatter walks rows/cells directly, bypassing
  // selectors on those nodes. Remove hidden cells before that traversal too.
  return {
    ...node,
    children: (node.children || []).filter((child) => !isHidden(child)).map(visibleTableContent),
  };
}

const convertHtml = compile({
  wordwrap: false,
  preserveNewlines: false,
  limits: { maxInputLength: RAW_EMAIL_CHAR_LIMIT },
  formatters: {
    evidenceVisibility(element, walk, builder) {
      if (isHidden(element)) return;
      // Re-enter the normal tag formatter after evaluating visibility. This
      // preserves table/list/paragraph behavior without duplicating formatters.
      const attribs = { ...element.attribs };
      delete attribs.style;
      delete attribs["aria-hidden"];
      walk([{ ...element, attribs }], builder);
    },
    evidenceImage(element, _walk, builder) {
      const alt = String(element.attribs?.alt || "").trim();
      builder.addInline(alt ? `[Image omitted: ${alt}]` : "[Image omitted]");
    },
    evidenceTable(element, walk, builder, options) {
      builder.options.formatters.dataTable!(visibleTableContent(element), walk, builder, options);
    },
    evidenceLink(element, walk, builder) {
      walk(element.children, builder);
      const href = element.attribs?.href || "";
      if (/^https?:\/\//i.test(href)) builder.addInline(` (${compactUrl(href)})`);
    },
  },
  selectors: [
    { selector: "a", format: "evidenceLink" },
    { selector: "img", format: "evidenceImage" },
    // Email layout tables also carry label/value relationships. Keep their rows
    // and column alignment instead of converting every cell into one paragraph.
    { selector: "table", format: "evidenceTable", options: { uppercaseHeaderCells: false, maxColumnWidth: 120 } },
    { selector: "[style]", format: "evidenceVisibility" },
    { selector: "[aria-hidden]", format: "evidenceVisibility" },
    ...["h1", "h2", "h3", "h4", "h5", "h6"].map((selector) => ({ selector, options: { uppercase: false } })),
    ...["style", "script", "template", "svg", "[hidden]"].map((selector) => ({ selector, format: "skip" })),
  ],
});

/** Semantic text for reasoning, separate from the sanitized HTML used by the reader. */
export function emailEvidenceText(input: unknown, format: "html" | "text" | "auto" = "auto"): string {
  const raw = String(input || "");
  if (raw.length > RAW_EMAIL_CHAR_LIMIT) {
    throw Object.assign(new Error("Email source is too large to normalize."), { code: "email_evidence_oversized" });
  }
  const isHtml = format === "html" || (format === "auto" && /<(?:html|body|div|p|table|tr|td|th|br|a|span|blockquote|ul|ol|li)\b[^>]*>/i.test(raw));
  const text = isHtml ? convertHtml(raw) : raw;
  return compactTextUrls(text)
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[\t ]+$/g, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Storage/discovery may be bounded, but consumers must know evidence is incomplete. */
export function boundEmailEvidence(text: string, maxChars = EMAIL_EVIDENCE_CHAR_LIMIT): string {
  if (text.length <= maxChars) return text;
  const budget = Math.max(0, maxChars - EMAIL_EVIDENCE_TRUNCATED.length - 2);
  return `${text.slice(0, budget)}\n\n${EMAIL_EVIDENCE_TRUNCATED}`;
}

/** Decisions must not infer absence of obligations or amounts from a silent prefix. */
export function requireCompleteEmailEvidence(input: unknown): string {
  const text = emailEvidenceText(input);
  if (text.length > EMAIL_EVIDENCE_CHAR_LIMIT || text.includes(EMAIL_EVIDENCE_TRUNCATED)) {
    throw Object.assign(new Error("Complete email evidence exceeds the decision limit; review the full email."), {
      code: "email_evidence_incomplete",
    });
  }
  return text;
}
