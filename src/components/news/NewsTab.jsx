import { useEffect, useState } from "react";
import useNews from "../../hooks/useNews.js";
import { markNewsSeen } from "../../api.js";
import { resolveDividerMarker } from "./newsPageModel.js";
import NewsView from "./NewsView.jsx";
import NewsManagePanel from "./NewsManagePanel.jsx";

export default function NewsTab({ active }) {
  const { news, loading, error, refreshing, reload, refresh } = useNews({ active });
  const [prevNews, setPrevNews] = useState(news);
  const [dividerMarker, setDividerMarker] = useState(null);
  const [manageOpen, setManageOpen] = useState(false);

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
      navigator.sendBeacon?.("/api/news/seen") || bump();
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
        onRefresh={refresh}
        onOpenManage={() => setManageOpen(true)}
        onReload={reload}
      />
      <NewsManagePanel
        open={manageOpen}
        onClose={() => setManageOpen(false)}
        news={news}
        onChanged={() => reload({ background: true })}
      />
    </>
  );
}
