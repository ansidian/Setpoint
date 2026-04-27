import { useState, useRef, useLayoutEffect } from "react";
import { cn } from "@/lib/utils";
import Section from "../layout/Section";
import EmailSection from "./EmailSection";
import LiveEmailSection from "./LiveEmailSection";
import { useDashboard } from "../../context/DashboardContext";
import useLiveEmailState from "../../hooks/useLiveEmailState";

export default function EmailTabSection({
  summary, model, emails, pinnedIds, briefingGeneratedAt, loaded, delay, className, onRefreshLive,
}) {
  const [activeTab, setActiveTab] = useState("briefing");
  const { emailSectionRef } = useDashboard();
  const containerRef = useRef(null);
  const prevHeight = useRef(null);
  const scrollTimer = useRef(null);

  const liveState = useLiveEmailState(emails, pinnedIds);
  const liveCount = liveState.unreadCount;

  function switchTab(tab) {
    if (tab === activeTab) return;
    // snapshot height before React re-renders
    if (containerRef.current) {
      prevHeight.current = containerRef.current.offsetHeight;
    }
    setActiveTab(tab);
  }

  // runs after DOM update but before browser paint
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el || prevHeight.current === null) return;

    const from = prevHeight.current;
    const to = el.scrollHeight;
    prevHeight.current = null;

    // set to old height (no transition yet)
    el.style.transition = "none";
    el.style.height = `${from}px`;
    el.style.overflow = "hidden";

    const collapsing = to < from;
    const duration = collapsing ? 350 : 200;
    // expand: snappy overshoot — collapse: gentle ease-out
    const easing = collapsing
      ? "cubic-bezier(0.4, 0, 0.2, 1)"
      : "cubic-bezier(0.16, 1, 0.3, 1)";

    // next frame: animate to new height
    requestAnimationFrame(() => {
      el.style.transition = `height ${duration}ms ${easing}`;
      el.style.height = `${to}px`;
      // scroll at ~60% through — layout is close enough, feels immediate
      clearTimeout(scrollTimer.current);
      scrollTimer.current = setTimeout(() => {
        emailSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, duration * 0.6);
    });
  }, [activeTab, emailSectionRef]);

  function onTransitionEnd(e) {
    if (e.target !== containerRef.current) return;
    // release fixed height so within-tab expansions flow naturally
    containerRef.current.style.height = "";
    containerRef.current.style.overflow = "";
    containerRef.current.style.transition = "";
    // clear pending scroll if transition finished first
    clearTimeout(scrollTimer.current);
  }

  return (
    <>
      <div ref={emailSectionRef} />
      <Section
        title="Email"
        delay={delay}
        loaded={loaded}
        variant="band"
        className={className}
        summaryBadge={liveCount > 0 ? `${liveCount} email${liveCount !== 1 ? "s" : ""}` : "no new emails"}
        defaultExpanded={false}
      >
        {/* Tab bar */}
        <div
          className="flex gap-0.5 mb-4 rounded-lg p-1"
          style={{ background: "rgba(255,255,255,0.02)" }}
        >
          <button
            onClick={() => switchTab("briefing")}
            className={cn(
              "flex-1 flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-md text-[11px] font-medium cursor-pointer transition-all duration-150 border font-[inherit]",
              activeTab === "briefing"
                ? "font-semibold"
                : "border-transparent bg-transparent",
            )}
            style={activeTab === "briefing" ? {
              color: "#cba6da",
              background: "rgba(203,166,218,0.07)",
              borderColor: "rgba(203,166,218,0.2)",
            } : {
              color: "rgba(255,255,255,0.35)",
            }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
              <polyline points="22,6 12,13 2,6" />
            </svg>
            Briefing
          </button>
          <button
            onClick={() => switchTab("live")}
            className={cn(
              "flex-1 flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-md text-[11px] font-medium cursor-pointer transition-all duration-150 border font-[inherit]",
              activeTab === "live"
                ? "font-semibold"
                : "border-transparent bg-transparent",
            )}
            style={activeTab === "live" ? {
              color: "rgba(99,102,241,0.9)",
              background: "rgba(99,102,241,0.07)",
              borderColor: "rgba(99,102,241,0.2)",
            } : {
              color: "rgba(255,255,255,0.35)",
            }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
            Live
            {liveCount > 0 && (
              <span
                className="text-[10px] font-bold tabular-nums rounded-full min-w-[16px] text-center"
                style={{
                  padding: "2px 6px",
                  background: activeTab === "live" ? "rgba(99,102,241,0.08)" : "rgba(99,102,241,0.15)",
                  color: activeTab === "live" ? "rgba(99,102,241,0.5)" : "rgba(99,102,241,0.9)",
                }}
              >
                {liveCount}
              </span>
            )}
          </button>
        </div>

        {/* Tab content */}
        <div ref={containerRef} onTransitionEnd={onTransitionEnd}>
          <div style={{ display: activeTab === "briefing" ? "block" : "none" }}>
            <EmailSection
              summary={summary}
              model={model}
              loaded={loaded}
              delay={delay}
              embedded
              active={activeTab === "briefing"}
            />
          </div>
          <div style={{ display: activeTab === "live" ? "block" : "none" }}>
            <LiveEmailSection
              briefingGeneratedAt={briefingGeneratedAt}
              loaded={loaded}
              delay={delay}
              embedded
              active={activeTab === "live"}
              onRefreshLive={onRefreshLive}
              liveState={liveState}
            />
          </div>
        </div>
      </Section>
    </>
  );
}
