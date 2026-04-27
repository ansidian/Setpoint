import { cn } from "@/lib/utils";
import useIsMobile from "../../hooks/useIsMobile";
import { getGmailUrl } from "../../lib/email-links";

// Gmail external link — shared across email row variants
function GmailLink({ email }) {
  const url = getGmailUrl(email);
  if (!url) return null;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      title="Open in Gmail"
      className="transition-colors duration-150 text-muted-foreground/30 hover:text-muted-foreground/70 hover:bg-white/[0.04] p-1 rounded leading-none inline-flex"
    >
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3" />
      </svg>
    </a>
  );
}

// Urgent flag badge — shared across email row variants
function UrgentFlag({ email, size = "desktop" }) {
  if (!email.urgentFlag) return null;
  const mobile = size === "mobile";
  return (
    <div
      className={cn(
        "font-semibold tracking-wide rounded-md whitespace-nowrap px-2 py-1 flex items-center gap-1",
        mobile
          ? "text-xs mt-0.5 w-fit"
          : "text-[9px] tracking-wider w-fit",
      )}
      style={{
        color: "#f97316",
        background: "rgba(249,115,22,0.08)",
        border: "1px solid rgba(249,115,22,0.2)",
      }}
    >
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
      </svg>
      {email.urgentFlag.label}
    </div>
  );
}

/**
 * Shared email row used by both EmailSection and LiveEmailSection. Clicking
 * the row opens the email in an EmailReaderOverlay via `onOpen`. There is
 * no inline expansion — the reader lives in a portal-based modal instead.
 *
 * Props:
 * - email          — email data object
 * - dimmed         — whether the row should appear faded (read, carried-over)
 * - onOpen         — called with `email` when the row is clicked
 * - rowRef         — ref callback for scroll-into-view
 * - accentBar      — ReactNode for the left accent bar
 * - desktopMeta    — ReactNode before the from line on desktop
 * - desktopAfterFrom — ReactNode after the from line on desktop
 * - mobileBeforeFrom — ReactNode before the from line on mobile
 * - mobileMeta     — ReactNode after the from line on mobile
 * - desktopActions — ReactNode for the right-side action buttons on desktop
 * - mobileActions  — ReactNode for extra mobile-only action buttons
 * - preview        — preview text to show below the from line
 * - hideUrgentFlag — suppress built-in UrgentFlag rendering
 * - className      — extra classes
 */
export default function EmailRow({
  email,
  dimmed,
  onOpen,
  onContextMenu,
  rowRef,
  accentBar,
  desktopMeta,
  desktopAfterFrom,
  mobileBeforeFrom,
  mobileMeta,
  desktopActions,
  mobileActions,
  preview,
  hideUrgentFlag,
  className: cls,
}) {
  const isMobile = useIsMobile();

  const handleClick = () => onOpen?.(email);

  return (
    <div
      ref={rowRef}
      data-email-id={email.uid || email.id}
      role="button"
      tabIndex={0}
      onClick={handleClick}
      onContextMenu={onContextMenu}
      className={cn(
        "group relative cursor-pointer transition-all duration-150 py-3.5 px-2 border-t border-white/[0.04] first:border-t-0",
        accentBar && "pl-5",
        dimmed && "opacity-50",
        cls,
      )}
    >
      {accentBar}

      {/* Hover bg */}
      <div className="absolute inset-0 bg-white/0 group-hover:bg-white/[0.025] transition-colors duration-150" />

      <div
        data-email-header
        className={cn(
          "relative",
          isMobile ? "flex flex-col gap-1" : "flex justify-between items-start gap-3",
        )}
      >
        {isMobile ? (
          <>
            <div className="text-[13px] font-medium text-foreground/90">
              {email.subject}
            </div>
            <div className="flex items-center gap-1.5">
              {mobileBeforeFrom}
              <span className="text-xs text-muted-foreground/50 truncate">
                {email.from}
              </span>
              {mobileMeta}
              {mobileActions}
            </div>
            {!hideUrgentFlag && <UrgentFlag email={email} size="mobile" />}
            {preview && (
              <div className="text-xs text-muted-foreground/40 leading-relaxed overflow-hidden text-ellipsis whitespace-nowrap">
                {preview}
              </div>
            )}
          </>
        ) : (
          <>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                {desktopMeta}
                <span className="text-[11px] text-muted-foreground/50">
                  {email.from}
                </span>
                {desktopAfterFrom}
              </div>
              <div className="text-[13px] font-medium text-foreground/90 mt-0.5">
                {email.subject}
              </div>
              {!hideUrgentFlag && <UrgentFlag email={email} size="desktop" />}
              {preview && (
                <div className="text-[11px] text-muted-foreground/40 mt-1 leading-relaxed overflow-hidden text-ellipsis whitespace-nowrap">
                  {preview}
                </div>
              )}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {desktopActions}
              <GmailLink email={email} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
