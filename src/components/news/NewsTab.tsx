import { useEffect, useState } from "react";
import useNews from "../../hooks/useNews";
import { markNewsSeen } from "../../api";
import { resolveDividerMarker } from "./newsPageModel";
import NewsView from "./NewsView";
import NewsManagePanel from "./NewsManagePanel";
import type { NewsPageEnvelope } from "../../../shared/types/news.ts";

const HIDE_SEEN_KEY = "news.hideSeen";

function readHideSeen(): boolean {
  try {
    return window.localStorage.getItem(HIDE_SEEN_KEY) === "1";
  } catch {
    return false;
  }
}

interface NewsTabProps { active: boolean }

export default function NewsTab({ active }: NewsTabProps) {
  const { news, loading, error, refreshing, reload, refresh } = useNews({ active });
  const [prevNews, setPrevNews] = useState<NewsPageEnvelope | null>(news);
  const [dividerMarker, setDividerMarker] = useState<string | null>(null);
  const [manageOpen, setManageOpen] = useState(false);
  const [manageTopicId, setManageTopicId] = useState<number | null>(null);
  const [hideSeen, setHideSeen] = useState(readHideSeen);

  const openManage = (topicId: number | null = null) => {
    setManageTopicId(topicId);
    setManageOpen(true);
  };

  const closeManage = () => {
    setManageOpen(false);
    setManageTopicId(null);
  };

  if (!active && manageOpen) closeManage();

  const toggleHideSeen = () => {
    setHideSeen((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(HIDE_SEEN_KEY, next ? "1" : "0");
      } catch {
        // storage unavailable (private mode) — session-only toggle is fine
      }
      return next;
    });
  };

  const markAllSeen = () => {
    const now = new Date().toISOString();
    markNewsSeen(now).catch(() => {});
    setDividerMarker(now);
  };

  // Hold the first non-null server marker for the whole visit; background
  // refetches must not move the divider mid-scan. Adjusting state during
  // render (not an effect) on a news-identity change, per React's documented
  // "adjusting state when a prop changes" pattern.
  if (news !== prevNews) {
    setPrevNews(news);
    if (news) setDividerMarker((held) => resolveDividerMarker(news.lastSeenAt, held));
  }

  // Bump on leave: when `active` flips false (tab switch) the effect cleanup
  // fires; pagehide covers closing the window while on the tab.
  useEffect(() => {
    if (!active) return undefined;
    const bump = () => {
      markNewsSeen(new Date().toISOString()).catch(() => {});
    };
    const onPageHide = () => {
      if (!navigator.sendBeacon?.("/api/news/seen")) bump();
    };
    window.addEventListener("pagehide", onPageHide);
    return () => {
      window.removeEventListener("pagehide", onPageHide);
      bump();
      setDividerMarker(null); // next visit gets a fresh divider
    };
  }, [active]);

  return (
    <>
      <NewsView
        news={news}
        loading={loading}
        error={error}
        refreshing={refreshing}
        dividerMarker={dividerMarker}
        hideSeen={hideSeen}
        onToggleHideSeen={toggleHideSeen}
        onMarkAllSeen={markAllSeen}
        onRefresh={refresh}
        onOpenManage={openManage}
        onReload={reload}
      />
      <NewsManagePanel
        open={manageOpen}
        initialTopicId={manageTopicId}
        onClose={closeManage}
        news={news}
        onChanged={() => reload({ background: true })}
      />
    </>
  );
}
