import { timeAgo } from "../dashboard/rails/railModel.js";

function faviconUrl(url) {
  try {
    const { hostname } = new URL(url);
    return `https://icons.duckduckgo.com/ip3/${hostname}.ico`;
  } catch {
    return null;
  }
}

export default function NewsItemRow({ item, showExcerpt }) {
  const favicon = faviconUrl(item.url);
  return (
    <div style={{ display: "grid", gap: 2, padding: "6px 0" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
        {favicon ? (
          <img
            src={favicon}
            width={14}
            height={14}
            loading="lazy"
            alt=""
            style={{ flexShrink: 0, borderRadius: 3 }}
            onError={(ev) => { ev.currentTarget.style.display = "none"; }}
          />
        ) : null}
        <a
          href={item.url}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            color: "var(--sp-text)",
            fontSize: 13.5,
            textDecoration: "none",
            transition: "color 150ms",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            minWidth: 0,
          }}
          onMouseEnter={(ev) => { ev.currentTarget.style.color = "var(--sp-accent)"; }}
          onMouseLeave={(ev) => { ev.currentTarget.style.color = "var(--sp-text)"; }}
          onFocus={(ev) => { ev.currentTarget.style.color = "var(--sp-accent)"; }}
          onBlur={(ev) => { ev.currentTarget.style.color = "var(--sp-text)"; }}
        >
          {item.title}
        </a>
        <span style={{ color: "var(--sp-subtext)", fontSize: 11, whiteSpace: "nowrap", flexShrink: 0 }}>
          {item.sourceTitle} · {timeAgo(item.publishedAt)}
        </span>
      </div>
      {showExcerpt && item.excerpt ? (
        <div
          style={{
            color: "var(--sp-subtext)",
            fontSize: 12,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            paddingLeft: 22,
          }}
        >
          {item.excerpt}
        </div>
      ) : null}
    </div>
  );
}
