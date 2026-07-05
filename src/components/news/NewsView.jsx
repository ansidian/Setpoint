import { useState } from "react";
import { RefreshCw, Settings2 } from "lucide-react";
import { timeAgo } from "../dashboard/rails/railModel.js";
import EmptyStateSplash from "../shared/EmptyStateSplash.jsx";
import NewsTopicSection from "./NewsTopicSection.jsx";

function HeaderButton({ onClick, disabled, children, ariaLabel }) {
  const [hover, setHover] = useState(false);
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      onClick={onClick}
      disabled={disabled}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onFocus={() => setHover(true)}
      onBlur={() => setHover(false)}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "6px 10px",
        borderRadius: 8,
        border: "1px solid rgba(255,255,255,0.08)",
        background: hover && !disabled ? "rgba(255,255,255,0.06)" : "transparent",
        color: "var(--sp-text)",
        fontSize: 12,
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.6 : 1,
        transition: "background 150ms, opacity 150ms",
      }}
    >
      {children}
    </button>
  );
}

export default function NewsView({
  news, loading, error, refreshing, dividerMarker, onRefresh, onOpenManage, onReload,
}) {
  if (loading && !news) return null;

  if (error && !news) {
    return (
      <EmptyStateSplash
        eyebrow="News"
        title="Couldn't load news"
        message="Something went wrong fetching the latest headlines."
        actions={<HeaderButton onClick={onReload} ariaLabel="Retry">Retry</HeaderButton>}
      />
    );
  }

  if (!news) return null;

  if (!news.topics.length) {
    return (
      <EmptyStateSplash
        eyebrow="News"
        title="Build your front page"
        message="Pick a few starter topics to get your first headlines, then customize sources any time."
        actions={<HeaderButton onClick={onOpenManage} ariaLabel="Add starter topics">Add starter topics</HeaderButton>}
      />
    );
  }

  return (
    <div style={{ maxWidth: 760, margin: "0 auto", padding: "20px 16px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20, color: "var(--sp-text)" }}>News</h2>
          <div style={{ fontSize: 11, color: "var(--sp-subtext)" }}>
            updated {news.lastUpdatedAt ? `${timeAgo(news.lastUpdatedAt)} ago` : "never"}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <HeaderButton onClick={onRefresh} disabled={refreshing} ariaLabel="Refresh news">
            <RefreshCw size={13} style={{ animation: refreshing ? "spin 0.8s linear infinite" : "none" }} />
          </HeaderButton>
          <HeaderButton onClick={onOpenManage} ariaLabel="Manage news sources">
            <Settings2 size={13} />
            Manage
          </HeaderButton>
        </div>
      </div>
      {news.topics.map((topic) => (
        <NewsTopicSection key={topic.id} topic={topic} dividerMarker={dividerMarker} />
      ))}
    </div>
  );
}
