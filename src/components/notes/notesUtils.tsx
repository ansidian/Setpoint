import { isDemoMode } from "../../demo/config.ts";
import type { ReactNode } from "react";

const URL_RE = /(https?:\/\/[^\s]+)/g;

export function linkifyText(text: string, accentColor?: string): ReactNode {
  const parts = text.split(URL_RE);
  if (parts.length === 1) return text;

  return parts.map((part, i) =>
    /^https?:\/\//.test(part) && !isDemoMode() ? (
      <a
        key={i}
        href={part}
        target="_blank"
        rel="noopener noreferrer"
        style={{ color: accentColor || "var(--ea-accent, var(--sp-accent))", textDecoration: "none" }}
        onMouseEnter={(e) => (e.currentTarget.style.textDecoration = "underline")}
        onMouseLeave={(e) => (e.currentTarget.style.textDecoration = "none")}
        onClick={(e) => e.stopPropagation()}
      >
        {part}
      </a>
    ) : (
      part
    ),
  );
}
