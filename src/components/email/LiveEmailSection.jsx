import { useState, useRef, useMemo, useCallback } from "react";
import { cn } from "@/lib/utils";
import { Pin, Star } from "lucide-react";
import Section from "../layout/Section";
import EmailRow from "./EmailRow";
import EmailReaderOverlay from "./EmailReaderOverlay";
import useEmailReaderNav from "../../hooks/email/useEmailReaderNav";
import { MotionList, MotionItem } from "../ui/motion-wrappers";
import { timeAgo } from "../../lib/dashboard-helpers";
import { CheckCheck } from "lucide-react";
import { Icon } from "@/lib/icons.jsx";
import ContextMenu from "../ui/ContextMenu";
import { markEmailAsRead, markEmailAsUnread } from "../../api";

function buildLiveEmailMenu(email, isRead, isPinned, {
  onOpen, onMarkRead, onMarkUnread, onTogglePin, onAddBill, onDismiss,
}) {
  return [
    { label: "Open", onSelect: onOpen },
    isRead
      ? { label: "Mark unread", onSelect: onMarkUnread }
      : { label: "Mark read", onSelect: onMarkRead },
    isPinned
      ? { label: "Remove from next briefing", onSelect: onTogglePin }
      : { label: "Include in next briefing", onSelect: onTogglePin },
    { label: "Add bill", onSelect: onAddBill },
    { type: "separator" },
    { label: "Dismiss", onSelect: onDismiss },
  ];
}


function getTimestampColor(dateStr) {
  if (!dateStr) return undefined;
  const mins = (Date.now() - new Date(dateStr).getTime()) / 60000;
  if (mins < 30) return "rgba(203,166,218,0.6)";
  if (mins < 120) return undefined;
  return "rgba(245,158,11,0.6)";
}

function getSectionTitle(briefingGeneratedAt) {
  if (!briefingGeneratedAt) return "Since This Morning";
  const hour = new Date(briefingGeneratedAt + "Z").toLocaleString("en-US", {
    timeZone: "America/Los_Angeles",
    hour: "numeric",
    hour12: false,
  });
  const h = parseInt(hour, 10);
  if (h >= 17) return "Since This Evening";
  if (h >= 12) return "Since This Afternoon";
  return "Since This Morning";
}

// Overlay footer Dismiss button — hides the email from the live list.
// Local-only; no server round-trip. Single-click (no confirm) because
// dismiss is reversible via page refresh, unlike briefing Trash.
function DismissAction({ onDismiss }) {
  return (
    <button
      onClick={onDismiss}
      className="flex items-center gap-1.5 text-[10px] font-medium text-muted-foreground/50 bg-transparent border border-white/[0.06] rounded-md px-2.5 py-1 cursor-pointer transition-colors duration-150 hover:text-foreground hover:border-white/[0.15]"
    >
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
      </svg>
      Dismiss
    </button>
  );
}

// Header toggle for the manual bill entry form. Live emails haven't been
// through Claude's bill extractor, so this lets the user fill in the form
// manually and push to Actual Budget via the same BillBadge component the
// briefing view uses for extracted bills. Responsive: icon-only below md.
function BillToggleAction({ open, onToggle }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={cn(
        "flex items-center gap-1 text-[10px] transition-colors px-2 py-1 cursor-pointer font-[inherit]",
        open
          ? "text-[#a6e3a1] bg-[#a6e3a1]/[0.08] hover:bg-[#a6e3a1]/[0.12]"
          : "text-muted-foreground/60 hover:text-foreground hover:bg-white/[0.04]",
      )}
      style={{ borderRadius: 8 }}
      aria-label={open ? "Hide bill form" : "Add bill"}
      title={open ? "Hide bill form" : "Add bill"}
    >
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <line x1="12" y1="1" x2="12" y2="23" />
        <path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6" />
      </svg>
      <span className="hidden md:inline">{open ? "Hide bill" : "Add bill"}</span>
    </button>
  );
}

function PinAction({ pinned, onToggle }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={cn(
        "flex items-center gap-1 text-[10px] transition-colors px-2 py-1 cursor-pointer font-[inherit]",
        pinned
          ? "text-[#cba6da] bg-[#cba6da]/[0.08] hover:bg-[#cba6da]/[0.12]"
          : "text-muted-foreground/60 hover:text-foreground hover:bg-white/[0.04]",
      )}
      style={{ borderRadius: 8 }}
      aria-label={
        pinned ? "Remove from next briefing" : "Include in next briefing"
      }
      title={pinned ? "Remove from next briefing" : "Include in next briefing"}
    >
      <Pin size={11} fill={pinned ? "currentColor" : "none"} />
      <span className="hidden md:inline">
        {pinned ? "Included" : "Include in briefing"}
      </span>
    </button>
  );
}

export default function LiveEmailSection({ briefingGeneratedAt, loaded, delay, className, embedded, active = true, onRefreshLive, liveState }) {
  const {
    visibleEmails,
    unreadCount,
    hasUnread,
    isRead,
    isPinned,
    markRead,
    markUnread,
    dismiss,
    pin,
    unpin,
    markAllRead,
    markingAllRead,
  } = liveState;

  const [openEmail, setOpenEmail] = useState(null);
  // Keyed by email uid so the bill form state auto-resets when the user
  // cycles to a different email via ↑/↓. Empty string = closed, uid = open.
  const [billFormForUid, setBillFormForUid] = useState("");
  const [emailMenu, setEmailMenu] = useState(null); // { email, x, y }
  const emailRowRefs = useRef({});

  const showBillForm = billFormForUid && billFormForUid === openEmail?.uid;
  const toggleBillForm = useCallback(() => {
    if (!openEmail?.uid) return;
    setBillFormForUid((prev) => (prev === openEmail.uid ? "" : openEmail.uid));
  }, [openEmail]);

  // Sorted list drives both the render order AND ↑/↓ navigation so keyboard
  // cycling matches what the user sees in the list.
  const sortedEmails = useMemo(
    () => [...visibleEmails].sort(
      (a, b) =>
        (b.isImportantSender ? 1 : 0) - (a.isImportantSender ? 1 : 0) ||
        new Date(b.date) - new Date(a.date),
    ),
    [visibleEmails],
  );

  const openEmailInReader = useCallback(
    (email) => {
      const effective = isRead(email) ? { ...email, read: true } : email;
      setOpenEmail(effective);
    },
    [isRead],
  );

  const closeReader = useCallback(() => setOpenEmail(null), []);

  const readerNav = useEmailReaderNav({
    list: sortedEmails,
    openEmail,
    onOpen: openEmailInReader,
  });

  const readerPreActions = openEmail ? (
    <PinAction
      pinned={isPinned(openEmail)}
      onToggle={() =>
        isPinned(openEmail) ? unpin(openEmail.uid) : pin(openEmail.uid)
      }
    />
  ) : null;

  const readerHeaderActions = openEmail ? (
    <BillToggleAction open={showBillForm} onToggle={toggleBillForm} />
  ) : null;

  const readerActions = openEmail ? (
    <DismissAction
      onDismiss={() => {
        dismiss(openEmail.uid);
        setOpenEmail(null);
      }}
    />
  ) : null;

  const handleMarkAllRead = async () => {
    await markAllRead();
    onRefreshLive?.();
  };

  const sectionTitle = getSectionTitle(briefingGeneratedAt);

  if (!visibleEmails.length) {
    if (!briefingGeneratedAt) return null;
    const emptyMsg = <p className="text-[12px] text-muted-foreground/40 m-0">No new emails since the last fetch.</p>;
    if (embedded) return emptyMsg;
    return (
      <Section title={sectionTitle} delay={delay} loaded={loaded} variant="band" className={className}>
        {emptyMsg}
      </Section>
    );
  }

  const briefingTime = briefingGeneratedAt
    ? timeAgo(briefingGeneratedAt + "Z", { compact: true })
    : null;

  const content = (
    <>
      <div className="flex items-center gap-2 mb-4">
        <span
          className="text-[10px] max-sm:text-xs font-bold px-2 py-0.5 rounded-full tabular-nums"
          style={{
            background: "rgba(203,166,218,0.1)",
            color: "rgba(203,166,218,0.8)",
          }}
        >
          {visibleEmails.length}
        </span>
        <span className="text-[12px] text-muted-foreground/50">
          email{visibleEmails.length !== 1 ? "s" : ""}
          {unreadCount > 0 &&
            unreadCount < visibleEmails.length &&
            ` · ${unreadCount} unread`}
          {briefingTime && ` · briefing ${briefingTime}`}
        </span>
        <span
          className="inline-block w-1.5 h-1.5 rounded-full animate-pulse ml-1"
          style={{ background: "rgba(203,166,218,0.6)" }}
        />
      </div>

      {/* Batch actions */}
      {visibleEmails.length > 0 && (
        <div className="mb-3 flex items-center gap-1.5">
          <button
            onClick={handleMarkAllRead}
            disabled={markingAllRead || !hasUnread}
            className={cn(
              "text-[10px] max-sm:text-xs font-medium rounded-md px-2.5 py-1.5 cursor-pointer transition-all duration-150 font-[inherit]",
              hasUnread
                ? "text-primary bg-primary/[0.08] border border-primary/20 hover:bg-primary/[0.15] hover:border-primary/30"
                : "text-muted-foreground/40 bg-white/[0.02] border border-white/[0.06]",
              "disabled:opacity-50 disabled:pointer-events-none",
            )}
          >
            <CheckCheck size={11} className="inline -mt-px" />
            {markingAllRead ? " Marking…" : " Mark all read"}
          </button>
        </div>
      )}

      <MotionList
        className="flex flex-col gap-1.5"
        loaded={loaded}
        delay={delay + 100}
        stagger={0.04}
      >
        {sortedEmails.map((email) => {
          const rowIsRead = isRead(email);
          const pinned = isPinned(email);
          const tsColor = getTimestampColor(email.date);
          return (
            <MotionItem key={email.uid}>
              <EmailRow
                email={email}
                dimmed={rowIsRead && !pinned}
                onOpen={openEmailInReader}
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setEmailMenu({ email, x: e.clientX, y: e.clientY });
                }}
                rowRef={(el) => {
                  emailRowRefs.current[email.uid] = el;
                }}
                preview={email.body_preview}
                accentBar={
                  pinned ? (
                    <div
                      className="absolute left-0 top-3 bottom-3 w-px rounded-full"
                      style={{
                        background: "#cba6da",
                        opacity: 0.7,
                        boxShadow: "0 0 6px rgba(203,166,218,0.3)",
                      }}
                    />
                  ) : email.isImportantSender ? (
                    <div
                      className="absolute left-0 top-3 bottom-3 w-px rounded-full"
                      style={{
                        background: "#f97316",
                        opacity: 0.7,
                        boxShadow: "0 0 6px rgba(249,115,22,0.3)",
                      }}
                    />
                  ) : null
                }
                desktopMeta={
                  <>
                    {email.account_icon && (
                      <span className="inline-flex items-center" style={{ color: email.account_color }}>
                        <Icon name={email.account_icon} size={10} />
                      </span>
                    )}
                    {email.account_label && (
                      <span className="text-[10px] text-muted-foreground/35">
                        {email.account_label}
                      </span>
                    )}
                    <span
                      className="inline-block w-1.5 h-1.5 rounded-full shrink-0"
                      style={{ background: email.account_color || "#cba6da" }}
                    />
                  </>
                }
                desktopAfterFrom={
                  email.isImportantSender ? (
                    <Star size={10} className="text-orange-400/80" fill="currentColor" />
                  ) : null
                }
                mobileBeforeFrom={
                  email.account_icon ? (
                    <span className="inline-flex items-center" style={{ color: email.account_color }}>
                      <Icon name={email.account_icon} size={12} />
                    </span>
                  ) : null
                }
                mobileMeta={
                  <>
                    {isPinned(email) && (
                      <Pin
                        size={10}
                        className="text-[#cba6da]/80"
                        fill="currentColor"
                      />
                    )}
                    {email.isImportantSender && (
                      <Star size={12} className="text-orange-400/80" fill="currentColor" />
                    )}
                    <span
                      className="text-xs text-muted-foreground/30 tabular-nums"
                      style={tsColor ? { color: tsColor } : undefined}
                    >
                      · {timeAgo(email.date, { compact: true })}
                    </span>
                  </>
                }
                desktopActions={
                  <>
                    {isPinned(email) && (
                      <Pin
                        size={10}
                        className="text-[#cba6da]/80"
                        fill="currentColor"
                      />
                    )}
                    <span
                      className="text-[10px] text-muted-foreground/30 tabular-nums"
                      style={tsColor ? { color: tsColor } : undefined}
                    >
                      {timeAgo(email.date, { compact: true })}
                    </span>
                  </>
                }
              />
            </MotionItem>
          );
        })}
      </MotionList>

      {/* Focus reader overlay — live list */}
      <EmailReaderOverlay
        open={active && !!openEmail}
        email={openEmail}
        onClose={closeReader}
        navigation={readerNav}
        preActions={readerPreActions}
        headerActions={readerHeaderActions}
        actions={readerActions}
        onMarkedRead={markRead}
        onMarkedUnread={markUnread}
        showManualBillForm={showBillForm}
        onLoaded={() => {
          if (!openEmail) return;
          const row = emailRowRefs.current[openEmail.uid];
          if (!row) return;
          const rect = row.getBoundingClientRect();
          if (rect.bottom > window.innerHeight || rect.top < 0) {
            row.scrollIntoView({ behavior: "smooth", block: "nearest" });
          }
        }}
      />

      {emailMenu && (
        <ContextMenu
          x={emailMenu.x}
          y={emailMenu.y}
          onClose={() => setEmailMenu(null)}
          items={buildLiveEmailMenu(
            emailMenu.email,
            isRead(emailMenu.email),
            isPinned(emailMenu.email),
            {
              onOpen: () => openEmailInReader(emailMenu.email),
              onMarkRead: async () => {
                markRead(emailMenu.email.uid);
                try { await markEmailAsRead(emailMenu.email.uid); } catch { /* ignore */ }
              },
              onMarkUnread: async () => {
                markUnread(emailMenu.email.uid);
                try { await markEmailAsUnread(emailMenu.email.uid); } catch { /* ignore */ }
              },
              onTogglePin: () =>
                isPinned(emailMenu.email)
                  ? unpin(emailMenu.email.uid)
                  : pin(emailMenu.email.uid),
              onAddBill: () => {
                setBillFormForUid(emailMenu.email.uid);
                setOpenEmail(emailMenu.email);
              },
              onDismiss: () => dismiss(emailMenu.email.uid),
            },
          )}
        />
      )}
    </>
  );

  if (embedded) return content;

  return (
    <Section title={sectionTitle} delay={delay} loaded={loaded} variant="band" className={className}>
      {content}
    </Section>
  );
}
