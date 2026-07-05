import { useState } from "react";
import { RefreshCw, Settings2 } from "lucide-react";
import { timeAgo } from "../dashboard/rails/railModel.js";
import EmptyStateSplash from "../shared/EmptyStateSplash.jsx";
import NewsTopicSection from "./NewsTopicSection.jsx";

// Topics flow top-to-bottom through CSS columns (newspaper reading order);
// `breakInside: avoid` on each section keeps a topic in one column.
const COLUMN_FLOW = { columnWidth: 360, columnGap: 44 };

function HeaderButton({ onClick, disabled, children, ariaLabel, ariaPressed }) {
  const [hover, setHover] = useState(false);
  const active = ariaPressed === true;
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      aria-pressed={ariaPressed}
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
        border: `1px solid ${active ? "color-mix(in srgb, var(--sp-accent) 45%, transparent)" : "rgba(255,255,255,0.08)"}`,
        background: hover && !disabled ? "rgba(255,255,255,0.06)" : "transparent",
        color: active ? "var(--sp-accent)" : "var(--sp-text)",
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

function updatedLabel(lastUpdatedAt) {
  if (!lastUpdatedAt) return "waiting for the first fetch";
  const ago = timeAgo(lastUpdatedAt);
  return ago === "now" ? "updated just now" : `updated ${ago} ago`;
}

function skeletonBar(width, height = 10) {
  return { width, height, borderRadius: 4, background: "rgba(255,255,255,0.05)" };
}

function NewsSkeleton() {
  return (
    <div aria-hidden style={COLUMN_FLOW}>
      {[0, 1, 2].map((section) => (
        <div key={section} style={{ breakInside: "avoid", marginBottom: 30, display: "grid", gap: 12 }}>
          <div style={skeletonBar(90, 8)} />
          <div style={{ display: "grid", gap: 6 }}>
            <div style={skeletonBar("85%", 13)} />
            <div style={skeletonBar("55%", 13)} />
          </div>
          {[0, 1, 2, 3].map((row) => (
            <div key={row} style={skeletonBar(`${88 - row * 9}%`)} />
          ))}
        </div>
      ))}
    </div>
  );
}

export default function NewsView({
  news, loading, error, refreshing, dividerMarker, hideSeen,
  onToggleHideSeen, onMarkAllSeen, onRefresh, onOpenManage, onReload,
}) {
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

  if (!news && !loading) return null;

  if (news && !news.topics.length) {
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
    <div style={{ maxWidth: 1280, margin: "0 auto", padding: "22px 28px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20, color: "var(--sp-text)" }}>News</h2>
          <div style={{ fontSize: 11, color: "var(--sp-subtext)" }}>
            {news ? updatedLabel(news.lastUpdatedAt) : "loading headlines…"}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <HeaderButton onClick={onToggleHideSeen} disabled={!news} ariaLabel="New only" ariaPressed={!!hideSeen}>
            New only
          </HeaderButton>
          <HeaderButton onClick={onMarkAllSeen} disabled={!news} ariaLabel="Mark all seen">
            Mark all seen
          </HeaderButton>
          <HeaderButton onClick={onRefresh} disabled={refreshing || !news} ariaLabel="Refresh news">
            <RefreshCw size={13} style={{ animation: refreshing ? "spin 0.8s linear infinite" : "none" }} />
          </HeaderButton>
          <HeaderButton onClick={onOpenManage} disabled={!news} ariaLabel="Manage news sources">
            <Settings2 size={13} />
            Manage
          </HeaderButton>
        </div>
      </div>
      {!news ? (
        <NewsSkeleton />
      ) : (
        <div style={COLUMN_FLOW}>
          {news.topics.map((topic) => (
            <NewsTopicSection key={topic.id} topic={topic} dividerMarker={dividerMarker} hideSeen={hideSeen} />
          ))}
        </div>
      )}
    </div>
  );
}
