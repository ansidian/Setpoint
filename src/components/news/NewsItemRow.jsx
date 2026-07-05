import { timeAgo } from "../dashboard/rails/railModel.js";
import { displayExcerpt } from "./newsPageModel.js";

function faviconUrl(url) {
  try {
    const { hostname } = new URL(url);
    return `https://icons.duckduckgo.com/ip3/${hostname}.ico`;
  } catch {
    return null;
  }
}

const CLAMP_TWO_LINES = {
  display: "-webkit-box",
  WebkitLineClamp: 2,
  WebkitBoxOrient: "vertical",
  overflow: "hidden",
};

// One headline. `variant="lead"` is the topic's front-page story: bigger
// title, excerpt, and the feed thumbnail when one exists. The whole row is
// the link (larger target than a bare title anchor); hover/focus styling
// lives on `.news-row` in index.css so 30+ rows don't each carry hover state.
export default function NewsItemRow({ item, variant = "compact" }) {
  const favicon = faviconUrl(item.url);
  const lead = variant === "lead";
  const excerpt = lead ? displayExcerpt(item.excerpt) : "";
  return (
    <a
      className="news-row"
      href={item.url}
      target="_blank"
      rel="noopener noreferrer"
      style={{
        display: "flex",
        gap: 12,
        alignItems: "flex-start",
        padding: lead ? "8px 10px" : "5px 10px",
        margin: "0 -10px",
      }}
    >
      <span style={{ display: "grid", gap: lead ? 4 : 3, minWidth: 0, flex: 1 }}>
        <span
          className="news-row-title"
          style={{
            color: "var(--sp-text)",
            fontSize: lead ? 14 : 12.5,
            fontWeight: lead ? 600 : 400,
            lineHeight: 1.4,
            ...CLAMP_TWO_LINES,
          }}
        >
          {item.title}
        </span>
        {excerpt ? (
          <span style={{ color: "var(--sp-subtext)", fontSize: 12, lineHeight: 1.5, ...CLAMP_TWO_LINES }}>
            {excerpt}
          </span>
        ) : null}
        <span
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            minWidth: 0,
            color: "var(--sp-subtext)",
            fontSize: 10.5,
          }}
        >
          {favicon ? (
            <img
              src={favicon}
              width={12}
              height={12}
              loading="lazy"
              alt=""
              style={{ flexShrink: 0, borderRadius: 3 }}
              onError={(ev) => { ev.currentTarget.style.display = "none"; }}
            />
          ) : null}
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {item.sourceTitle}
            {item.publishedAt ? ` · ${timeAgo(item.publishedAt)}` : ""}
          </span>
        </span>
      </span>
      {lead && item.thumbnailUrl ? (
        <img
          src={item.thumbnailUrl}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          style={{
            width: 68,
            height: 68,
            objectFit: "cover",
            borderRadius: 8,
            flexShrink: 0,
            border: "1px solid rgba(255,255,255,0.06)",
          }}
          onError={(ev) => { ev.currentTarget.style.display = "none"; }}
        />
      ) : null}
    </a>
  );
}
