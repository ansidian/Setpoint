import { timeAgo } from "../dashboard/rails/railModel.js";
import { displayExcerpt } from "./newsPageModel";
import type { NewsItem } from "../../../shared/types/news.ts";

function faviconUrl(url: string): string | null {
  try {
    const { hostname } = new URL(url);
    return `https://icons.duckduckgo.com/ip3/${hostname}.ico`;
  } catch {
    return null;
  }
}

// One headline. `variant="lead"` is the topic's front-page story: bigger
// title, excerpt, and the feed thumbnail when one exists. The whole row is
// the link (larger target than a bare title anchor); hover/focus styling
// lives on `.news-row` in index.css so 30+ rows don't each carry hover state.
interface NewsItemRowProps {
  item: NewsItem;
  variant?: "lead" | "compact";
}

export default function NewsItemRow({ item, variant = "compact" }: NewsItemRowProps) {
  const favicon = faviconUrl(item.url);
  const lead = variant === "lead";
  const excerpt = lead ? displayExcerpt(item.excerpt) : "";
  return (
    <a
      className={`news-row news-row--${lead ? "lead" : "compact"}`}
      href={item.url}
      target="_blank"
      rel="noopener noreferrer"
    >
      <span className="news-row-copy">
        <span className="news-row-title">{item.title}</span>
        {excerpt ? (
          <span className="news-row-excerpt">{excerpt}</span>
        ) : null}
        <span className="news-row-meta">
          {favicon ? (
            <img
              className="news-row-favicon"
              src={favicon}
              width={12}
              height={12}
              loading="lazy"
              alt=""
              onError={(ev) => { ev.currentTarget.style.display = "none"; }}
            />
          ) : null}
          <span className="news-row-source">
            {item.sourceTitle}
            {item.publishedAt ? ` · ${timeAgo(item.publishedAt)}` : ""}
          </span>
        </span>
      </span>
      {lead && item.thumbnailUrl ? (
        <img
          className="news-row-thumbnail"
          src={item.thumbnailUrl}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={(ev) => { ev.currentTarget.style.display = "none"; }}
        />
      ) : null}
    </a>
  );
}
