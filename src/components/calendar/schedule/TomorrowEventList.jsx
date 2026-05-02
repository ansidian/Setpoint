import { cn } from "@/lib/utils";

export default function TomorrowEventList({ events, showSource, opacity }) {
  return events.map((event, i) => (
    <div key={`tomorrow-${i}`}>
      <div
        className={cn(
          "group relative flex items-center gap-3 py-2 px-3 rounded-md transition-all duration-200",
          event.flag === "Conflict"
            ? "bg-destructive/[0.05]"
            : "bg-card/60",
        )}
        style={{
          border: event.flag === "Conflict"
            ? "1px solid rgba(243,139,168,0.2)"
            : "1px solid rgba(255,255,255,0.04)",
          opacity,
        }}
      >
        <div
          className="absolute -left-5 top-1/2 -translate-y-1/2 w-2 h-2 rounded-full shrink-0"
          style={{ background: event.color, opacity: 0.4 }}
        />
        <div
          className="absolute left-0 top-3 bottom-3 w-px rounded-full"
          style={{ background: event.color, opacity: 0.4 }}
        />
        <div className="min-w-[72px] ml-1">
          <div className="text-[13px] font-semibold tabular-nums text-foreground">
            {event.time}
          </div>
          <div className="text-[10px] max-sm:text-xs text-muted-foreground/50">
            {event.duration}
          </div>
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[12px] font-medium truncate text-foreground/90">
            {event.title}
          </div>
          {showSource && event.source && (
            <span
              className="inline-flex items-center gap-1 mt-0.5 text-[10px] max-sm:text-xs font-medium rounded px-1.5 py-px"
              style={{
                color: `${event.color}cc`,
                background: `${event.color}10`,
              }}
            >
              <span
                className="w-1.5 h-1.5 rounded-full shrink-0"
                style={{ background: event.color, opacity: 0.7 }}
              />
              {event.source}
            </span>
          )}
        </div>
        {event.flag && (
          <div
            className={cn(
              "text-[9px] max-sm:text-xs font-semibold tracking-wider uppercase py-1 px-2 rounded-md shrink-0",
              event.flag === "Conflict"
                ? "text-[#f38ba8] bg-[#f38ba8]/[0.08]"
                : "text-[#f9e2af] bg-[#f9e2af]/[0.08]",
            )}
          >
            {event.flag}
          </div>
        )}
      </div>
    </div>
  ));
}
