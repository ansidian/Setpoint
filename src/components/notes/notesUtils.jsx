const URL_RE = /(https?:\/\/[^\s]+)/g;

export function linkifyText(text, accentColor) {
  const parts = text.split(URL_RE);
  if (parts.length === 1) return text;

  return parts.map((part, i) =>
    /^https?:\/\//.test(part) ? (
      <a
        key={i}
        href={part}
        target="_blank"
        rel="noopener noreferrer"
        style={{ color: accentColor || "var(--ea-accent, #cba6da)", textDecoration: "none" }}
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
