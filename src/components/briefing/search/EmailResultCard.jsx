import DOMPurify from "dompurify";
import { cn } from "@/lib/utils";
import { formatEmailDate } from "./formatDate";

function pickBgClass({ isActive, isFocused, unread }) {
  if (isActive) return "bg-primary/[0.06]";
  if (isFocused) return "bg-white/[0.04]";
  if (unread) return "bg-primary/[0.025] hover:bg-white/[0.03]";
  return "hover:bg-white/[0.03]";
}

export default function EmailResultCard({ r, acctColor, isActive, isFocused, onMouseEnter, onOpen }) {
  const unread = !r.read;
  const bgClass = pickBgClass({ isActive, isFocused, unread });
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onMouseEnter={onMouseEnter}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen?.(); } }}
      className={cn(
        "group relative mx-2 rounded-lg transition-colors duration-150 cursor-pointer",
        bgClass,
      )}
      style={{ padding: "10px 12px 10px 16px", opacity: r.read && !isActive ? 0.75 : 1 }}
    >
      <div
        className="absolute left-0 top-2.5 bottom-2.5 w-px rounded-full transition-all duration-150"
        style={{
          background: acctColor,
          opacity: isActive ? 1 : unread ? 0.9 : 0.45,
          boxShadow: isActive ? `0 0 6px ${acctColor}80` : "none",
        }}
      />
      {/* Row 1: subject (title) + date */}
      <div className="flex items-baseline gap-2">
        <div
          className={cn(
            "flex-1 min-w-0 text-[13px] leading-snug truncate [&_mark]:bg-[#fab387]/35 [&_mark]:text-foreground [&_mark]:rounded-sm [&_mark]:px-px [&_mark]:font-semibold",
            unread ? "text-foreground font-semibold" : "text-foreground/85 font-medium",
          )}
          dangerouslySetInnerHTML={{
            __html: DOMPurify.sanitize(
              r.subject_highlight || r.subject,
              { ALLOWED_TAGS: ["mark"] },
            ),
          }}
        />
        <span className="text-[10px] text-muted-foreground/50 shrink-0 tabular-nums">
          {formatEmailDate(r.email_date)}
        </span>
      </div>
      {/* Row 2: from name · address (metadata) */}
      <div className="flex items-baseline gap-1.5 mt-0.5 text-[11px] text-muted-foreground/60 truncate">
        <span className="truncate">{r.from_name || r.from_address}</span>
        {r.from_name && r.from_address && (
          <>
            <span className="text-muted-foreground/30 shrink-0">·</span>
            <span className="truncate text-muted-foreground/45">{r.from_address}</span>
          </>
        )}
      </div>
      {/* Row 3: body snippet with highlight */}
      {r.body_highlight && (
        <div
          className="text-[12px] text-foreground/70 leading-relaxed truncate mt-1 [&_mark]:bg-primary/40 [&_mark]:text-foreground [&_mark]:rounded-sm [&_mark]:px-px"
          dangerouslySetInnerHTML={{
            __html: DOMPurify.sanitize(
              r.body_highlight,
              { ALLOWED_TAGS: ["mark"] },
            ),
          }}
        />
      )}
    </div>
  );
}
