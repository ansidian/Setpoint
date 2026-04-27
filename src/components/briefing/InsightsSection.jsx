import { useEffect, useReducer } from "react";
import Section from "../layout/Section";
import { MotionList, MotionItem } from "../ui/motion-wrappers";
import { resolveInsight } from "../../lib/insight-resolver";
import { Icon } from "@/lib/icons.jsx";

function formatStaleLabel(aiGeneratedAt) {
  if (!aiGeneratedAt) return null;
  const dt = new Date(aiGeneratedAt.endsWith("Z") ? aiGeneratedAt : aiGeneratedAt + "Z");
  const now = new Date();
  const diffH = Math.floor((now - dt) / 3_600_000);
  if (diffH < 1) return "less than an hour ago";
  if (diffH < 24) return `${diffH}h ago`;
  const day = dt.toLocaleDateString("en-US", { timeZone: "America/Los_Angeles", weekday: "long" });
  const time = dt.toLocaleTimeString("en-US", { timeZone: "America/Los_Angeles", hour: "numeric", minute: "2-digit" });
  return `${day} ${time}`;
}

export default function InsightsSection({
  insights,
  loaded,
  delay,
  style,
  className,
  staleCount = 0,
  aiGeneratedAt,
  isLatest = true,
}) {
  // Time reference used by the slot resolver. For the latest briefing we tick
  // every 60s so relative phrases like "tonight" roll over to "last night" as
  // the day progresses without requiring a manual refresh. For historical
  // briefings we freeze `now` to the briefing's generation time so it reads
  // exactly as it did when first generated. `forceTick` only exists to
  // trigger a re-render on interval — its reducer state is discarded.
  const [, forceTick] = useReducer((x) => x + 1, 0);
  useEffect(() => {
    if (!isLatest) return undefined;
    const id = setInterval(forceTick, 60_000);
    return () => clearInterval(id);
  }, [isLatest]);
  const now = !isLatest && aiGeneratedAt ? new Date(aiGeneratedAt) : new Date();

  if (!insights?.length) return null;
  const isStale = staleCount >= 1;

  return (
    <Section
      title="Claude's Insights"
      delay={delay}
      loaded={loaded}
      variant="band"
      style={style}
      className={className}
      summaryBadge={`${insights.length} item${insights.length !== 1 ? "s" : ""}`}
      defaultExpanded
    >
      {isStale && aiGeneratedAt && (
        <p
          className="text-[10px] leading-none mb-2"
          style={{ color: "rgba(255,255,255,0.25)" }}
        >
          From AI briefing {formatStaleLabel(aiGeneratedAt)}
        </p>
      )}
      <MotionList
        className="flex flex-col gap-1.5"
        loaded={loaded}
        delay={delay + 100}
        stagger={0.06}
      >
        {insights.map((insight, i) => (
          <MotionItem
            key={i}
            className="group relative flex items-start gap-3 border-t border-white/[0.04] py-3 first:border-t-0"
          >
            <span
              className="shrink-0 w-6 h-6 flex items-center justify-center rounded-md"
              style={{
                background: isStale ? "rgba(255,255,255,0.02)" : "rgba(203,166,218,0.08)",
                color: isStale ? "rgba(205,214,244,0.45)" : "#cba6da",
              }}
            >
              <Icon name={insight.icon} size={14} />
            </span>

            <span
              className={`text-[13px] leading-relaxed ${isStale ? "" : "text-foreground/75"}`}
              style={isStale ? { color: "rgba(205,214,244,0.45)" } : undefined}
            >
              {resolveInsight(insight, now)}
            </span>
          </MotionItem>
        ))}
      </MotionList>
    </Section>
  );
}
