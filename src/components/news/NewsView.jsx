import { useEffect, useRef, useState } from "react";
import { RefreshCw, Settings2 } from "lucide-react";
import { timeAgo } from "../dashboard/rails/railModel.js";
import EmptyStateSplash from "../shared/EmptyStateSplash";
import NewsTopicSection from "./NewsTopicSection.jsx";
import { planTopicSection, summarizeTopicSourceHealth } from "./newsPageModel.js";

function HeaderButton({ onClick, disabled, children, ariaLabel, ariaPressed, className = "" }) {
  return (
    <button
      type="button"
      className={`news-toolbar-button ${className}`.trim()}
      aria-label={ariaLabel}
      aria-pressed={ariaPressed}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}

function checkedLabel(lastUpdatedAt) {
  if (!lastUpdatedAt) return "waiting for the first check";
  const ago = timeAgo(lastUpdatedAt);
  return ago === "now" ? "checked just now" : `checked ${ago} ago`;
}

function skeletonBar(width, height = 10) {
  return <span className="news-skeleton-bar" style={{ width, height }} />;
}

function NewsSkeleton() {
  return (
    <div className="news-reading-layout news-reading-layout--loading" aria-hidden="true">
      <div className="news-topic-index news-topic-index--skeleton">
        {skeletonBar(52, 9)}
        {skeletonBar("88%", 28)}
        {skeletonBar("72%", 28)}
        {skeletonBar("80%", 28)}
      </div>
      <div className="news-topic-bands">
        {[0, 1, 2].map((section) => (
          <div className="news-topic-band news-topic-band--skeleton" key={section}>
            {skeletonBar(96, 15)}
            <div className="news-topic-content">
              <div className="news-skeleton-lane">
                {skeletonBar("88%", 15)}
                {skeletonBar("62%", 15)}
                {skeletonBar("96%", 10)}
                {skeletonBar("72%", 10)}
              </div>
              <div className="news-skeleton-lane">
                {[0, 1, 2, 3].map((row) => (
                  <span key={row}>{skeletonBar(`${92 - row * 8}%`)}</span>
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function NewsView({
  news, loading, error, refreshing, dividerMarker, hideSeen,
  onToggleHideSeen, onMarkAllSeen, onRefresh, onOpenManage, onReload,
}) {
  const viewRef = useRef(null);
  const [trackedTopicId, setTrackedTopicId] = useState(null);
  const topicIndex = (news?.topics || []).map((topic) => ({
    id: topic.id,
    name: topic.name,
    freshCount: planTopicSection(topic.items, dividerMarker, { hideSeen }).freshCount,
    sourceHealth: summarizeTopicSourceHealth(topic.sources),
  }));
  const totalNew = topicIndex.reduce((total, topic) => total + topic.freshCount, 0);
  const topicKey = topicIndex.map((topic) => topic.id).join("|");
  const activeTopicId = topicIndex.some((topic) => String(topic.id) === trackedTopicId)
    ? trackedTopicId
    : String(topicIndex[0]?.id ?? "");

  useEffect(() => {
    const view = viewRef.current;
    if (!view || !topicKey) return undefined;
    const scrollRegion = view.closest("[data-scroll-lock-target]");
    const scrollTarget = scrollRegion || window;

    const updateActiveTopic = () => {
      const sections = [...view.querySelectorAll("[data-news-topic-id]")];
      if (!sections.length) return;
      const rootTop = scrollRegion?.getBoundingClientRect().top || 0;
      const toolbarHeight = view.querySelector(".news-toolbar")?.offsetHeight || 0;
      const activationLine = rootTop + toolbarHeight + 16;
      const sectionTops = sections.map((section) => section.getBoundingClientRect().top);
      let nextTopicId = sections[0].dataset.newsTopicId;

      if (!sectionTops.every((top) => top === sectionTops[0])) {
        sections.forEach((section, index) => {
          if (sectionTops[index] <= activationLine) nextTopicId = section.dataset.newsTopicId;
        });
      }
      setTrackedTopicId((current) => current === nextTopicId ? current : nextTopicId);
    };

    updateActiveTopic();
    scrollTarget.addEventListener("scroll", updateActiveTopic, { passive: true });
    window.addEventListener("resize", updateActiveTopic);
    return () => {
      scrollTarget.removeEventListener("scroll", updateActiveTopic);
      window.removeEventListener("resize", updateActiveTopic);
    };
  }, [topicKey]);

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
        actions={(
          <HeaderButton onClick={() => onOpenManage?.()} ariaLabel="Add starter topics">
            Add starter topics
          </HeaderButton>
        )}
      />
    );
  }

  return (
    <div className="news-view" ref={viewRef}>
      <header className="news-toolbar">
        <div className="news-toolbar-title-group">
          <h2>News</h2>
          {news ? (
            <span className="news-toolbar-summary">
              {totalNew} new · {topicIndex.length} {topicIndex.length === 1 ? "topic" : "topics"}
            </span>
          ) : null}
          <span className="news-toolbar-updated" aria-live="polite">
            {news ? checkedLabel(news.lastUpdatedAt) : "checking headlines…"}
          </span>
        </div>
        <div className="news-toolbar-actions">
          <div className="news-view-switcher" role="group" aria-label="Story visibility">
            <HeaderButton
              onClick={() => { if (hideSeen) onToggleHideSeen(); }}
              disabled={!news}
              ariaLabel="All"
              ariaPressed={!hideSeen}
            >
              All
            </HeaderButton>
            <HeaderButton
              onClick={() => { if (!hideSeen) onToggleHideSeen(); }}
              disabled={!news}
              ariaLabel="New"
              ariaPressed={!!hideSeen}
            >
              New
            </HeaderButton>
          </div>
          <HeaderButton onClick={onMarkAllSeen} disabled={!news} ariaLabel="Mark caught up">
            Mark caught up
          </HeaderButton>
          <HeaderButton
            onClick={onRefresh}
            disabled={refreshing || !news}
            ariaLabel="Refresh news"
            className="news-toolbar-button--icon"
          >
            <RefreshCw className={refreshing ? "news-refresh-icon news-refresh-icon--active" : "news-refresh-icon"} size={14} />
          </HeaderButton>
          <HeaderButton onClick={() => onOpenManage?.()} disabled={!news} ariaLabel="Sources">
            <Settings2 size={13} />
            Sources
          </HeaderButton>
        </div>
      </header>
      {!news ? (
        <NewsSkeleton />
      ) : (
        <div className="news-reading-layout">
          <nav className="news-topic-index" aria-label="News topics">
            <span className="news-topic-index-label">Topics</span>
            {topicIndex.map((topic) => (
              <a
                key={topic.id}
                href={`#news-topic-${topic.id}`}
                aria-current={String(topic.id) === activeTopicId ? "location" : undefined}
              >
                <span className="news-topic-index-name">{topic.name}</span>
                <span className="news-topic-index-state" data-new={topic.freshCount > 0 ? "true" : "false"}>
                  {topic.freshCount > 0 ? `${topic.freshCount} new` : "Caught up"}
                </span>
                {topic.sourceHealth ? (
                  <span className={`news-topic-index-health news-topic-index-health--${topic.sourceHealth.tone}`}>
                    {topic.sourceHealth.label}
                  </span>
                ) : null}
              </a>
            ))}
          </nav>
          <div className="news-topic-bands">
            {news.topics.map((topic) => (
              <NewsTopicSection
                key={topic.id}
                topic={topic}
                dividerMarker={dividerMarker}
                hideSeen={hideSeen}
                onOpenManage={onOpenManage}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
