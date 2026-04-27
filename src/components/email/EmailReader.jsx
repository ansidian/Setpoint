import { useState, useEffect, useRef } from "react";
import { getEmailBody, markEmailAsRead, markEmailAsUnread } from "../../api";
import EmailIframe from "./EmailIframe";
import BillBadge from "../bills/BillBadge";
import { urgencyStyles } from "../../lib/dashboard-helpers";
import { getGmailUrl } from "../../lib/email-links";
import { Icon } from "@/lib/icons.jsx";
import { CreditCard } from "lucide-react";

const AUTO_MARK_DELAY_MS = 1500;

function formatFullDate(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  if (isNaN(d)) return "";
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

// Compact form for mobile header: "Apr 8, 9:09 AM" — drops the year.
function formatCompactDate(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  if (isNaN(d)) return "";
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

// Email from-names frequently arrive wrapped in quotes (e.g. '"PayPal
// Cashback World Mastercard®" <customer.service@...>'). Strip outer quote
// pairs so the mobile header shows just the readable name.
function stripQuotes(s) {
  if (!s) return "";
  return s.replace(/^["'](.*)["']$/, "$1");
}

// Unified email body viewer used by the search modal/sheet AND the dashboard
// focus reader overlay. Loads the body lazily (unless email.fullBody is
// already present), schedules a delayed auto-mark-as-read so quick peeks
// don't burn the unread state, and optionally renders a pinned briefing triage
// strip above the body for briefing emails.
//
// Props:
//  - email: the email object. Supports both search shape (email.uid +
//    email.email_date) and dashboard shape (email.id + email.date). If
//    email.fullBody is set, skips the lazy fetch.
//  - triage: optional object { action, urgency, hasBill, summary }. When
//    present, renders the briefing triage strip above the body. Omit on live
//    view or any context without Claude analysis.
//  - navigation: optional { position: { index, total }, hasPrev, hasNext,
//    onPrev, onNext }. Position renders in the header. onPrev/onNext render
//    prev/next buttons — omit if the parent owns keyboard navigation (e.g.
//    search, where ↑/↓ live on the search input).
//  - preActions: optional ReactNode rendered in the header row, before the
//    mark-read toggle. Use for high-priority constructive actions (e.g. pin).
//  - headerActions: optional ReactNode rendered in the header row, between
//    mark-read and the Gmail link. Use for non-destructive actions like
//    "Add bill". Kept separate from `actions` so constructive and
//    destructive actions don't sit next to each other.
//  - actions: optional ReactNode rendered in the footer (e.g. Trash/Dismiss).
//  - onMarkedRead / onMarkedUnread: called after auto- or manual mark changes
//    complete, so parent can update list state.
//  - onLoaded: called once the body finishes loading (or is short-circuited
//    by email.fullBody). Used by callers that show a spinner elsewhere in
//    the UI while waiting (e.g. bill row loading indicator).
//  - showManualBillForm: when true, render an empty BillBadge form below the
//    body even if email.extractedBill is absent. Used by the live view's
//    footer toggle to let the user manually create a bill from an email
//    Claude hasn't analyzed.
//  - onClose: optional close button in header.
export default function EmailReader({
  email,
  triage,
  navigation,
  preActions,
  headerActions,
  actions,
  onMarkedRead,
  onMarkedUnread,
  onLoaded,
  showManualBillForm,
  onClose,
}) {
  const emailKey = email.uid || email.id;

  // result.key tracks which emailKey the loaded body belongs to.
  // If result.key !== emailKey, we're still loading the new email.
  const [result, setResult] = useState({ key: null, body: null, error: null });
  const [localRead, setLocalRead] = useState(!!email.read);
  const [toggling, setToggling] = useState(false);
  const markedRef = useRef(null);
  const autoMarkTimerRef = useRef(null);

  useEffect(() => {
    setLocalRead(!!email.read);
  }, [emailKey, email.read]);

  useEffect(() => {
    // Escape hatch: some emails (e.g. iCloud live emails) ship their body
    // embedded in the briefing payload. Skip the network round-trip.
    if (email.fullBody) {
      setResult({ key: emailKey, body: email.fullBody, error: null });
      onLoaded?.();
      return;
    }
    let cancelled = false;
    getEmailBody(emailKey)
      .then((res) => {
        if (cancelled) return;
        setResult({ key: emailKey, body: res.html_body || res.body || "", error: null });
        onLoaded?.();
      })
      .catch((err) => {
        if (cancelled) return;
        setResult({ key: emailKey, body: null, error: err.message || "Failed to load email" });
        onLoaded?.();
      });
    return () => { cancelled = true; };
    // onLoaded deliberately excluded from deps — it's a fire-and-forget
    // signal that should track the emailKey lifecycle, not callback identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [emailKey, email.fullBody]);

  const loading = result.key !== emailKey;
  const body = loading ? null : result.body;
  const error = loading ? null : result.error;

  // Delayed auto mark-as-read. We wait AUTO_MARK_DELAY_MS after the body
  // loads so a quick peek-and-swap doesn't burn the unread state. Timer is
  // cancelled if the user closes/swaps or manually toggles.
  useEffect(() => {
    if (loading || error || email.read || markedRef.current === emailKey) return;
    autoMarkTimerRef.current = setTimeout(() => {
      markedRef.current = emailKey;
      setLocalRead(true);
      markEmailAsRead(emailKey)
        .then(() => onMarkedRead?.(emailKey))
        .catch((err) => console.error("Failed to mark email read:", err.message));
    }, AUTO_MARK_DELAY_MS);
    return () => {
      if (autoMarkTimerRef.current) {
        clearTimeout(autoMarkTimerRef.current);
        autoMarkTimerRef.current = null;
      }
    };
  }, [loading, error, emailKey, email.read, onMarkedRead]);

  async function handleToggleRead() {
    if (toggling) return;
    if (autoMarkTimerRef.current) {
      clearTimeout(autoMarkTimerRef.current);
      autoMarkTimerRef.current = null;
    }
    setToggling(true);
    const next = !localRead;
    setLocalRead(next);
    try {
      if (next) {
        markedRef.current = emailKey;
        await markEmailAsRead(emailKey);
        onMarkedRead?.(emailKey);
      } else {
        markedRef.current = null;
        await markEmailAsUnread(emailKey);
        onMarkedUnread?.(emailKey);
      }
    } catch (err) {
      console.error("Failed to toggle read state:", err.message);
      setLocalRead(!next); // revert
    } finally {
      setToggling(false);
    }
  }

  const isHtml = body && /<[a-z!/]/i.test(body);
  const dateField = email.email_date || email.date;

  return (
    <div className="flex flex-col min-h-0 flex-1">
      {/* Header */}
      <div
        className="px-5 py-3 shrink-0 max-sm:px-3 max-sm:py-2.5"
        style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}
      >
        <div className="flex items-center gap-2 mb-2">
          <span className="shrink-0 flex items-center" style={{ color: email.account_color }}><Icon name={email.account_icon || "Mail"} size={14} /></span>
          <span className="text-[11px] font-semibold text-foreground/80">
            {email.account_label}
          </span>
          <span className="hidden md:inline text-[10px] text-muted-foreground/40 truncate">
            {email.account_email}
          </span>
          {navigation?.position && (
            <span className="text-[10px] text-muted-foreground/40 shrink-0 tabular-nums ml-1">
              {navigation.position.index + 1} of {navigation.position.total}
            </span>
          )}
          <div className="ml-auto flex items-center gap-1 shrink-0">
            {navigation?.onPrev && (
              <button
                type="button"
                onClick={navigation.onPrev}
                disabled={!navigation.hasPrev}
                className="w-6 h-6 flex items-center justify-center text-muted-foreground/50 hover:text-foreground hover:bg-white/[0.06] transition-colors disabled:opacity-20 disabled:cursor-not-allowed"
                style={{ borderRadius: 6 }}
                aria-label="Previous email"
                title="Previous (↑)"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="18 15 12 9 6 15" />
                </svg>
              </button>
            )}
            {navigation?.onNext && (
              <button
                type="button"
                onClick={navigation.onNext}
                disabled={!navigation.hasNext}
                className="w-6 h-6 flex items-center justify-center text-muted-foreground/50 hover:text-foreground hover:bg-white/[0.06] transition-colors disabled:opacity-20 disabled:cursor-not-allowed"
                style={{ borderRadius: 6 }}
                aria-label="Next email"
                title="Next (↓)"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </button>
            )}
            {preActions}
            <button
              type="button"
              onClick={handleToggleRead}
              disabled={toggling}
              className="flex items-center gap-1 text-[10px] text-muted-foreground/60 hover:text-foreground transition-colors px-2 py-1 hover:bg-white/[0.04] disabled:opacity-50"
              style={{ borderRadius: 8 }}
              title={localRead ? "Mark as unread" : "Mark as read"}
            >
              {localRead ? (
                <>
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                    <polyline points="22,6 12,13 2,6" />
                  </svg>
                  <span className="hidden md:inline">Mark unread</span>
                </>
              ) : (
                <>
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
                  </svg>
                  <span className="hidden md:inline">Mark read</span>
                </>
              )}
            </button>
            {headerActions}
            {(() => {
              const webUrl = email.web_url || getGmailUrl(email);
              return webUrl ? (
                <a
                  href={webUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-[10px] text-primary/80 hover:text-primary transition-colors px-2 py-1 hover:bg-white/[0.04]"
                  style={{ borderRadius: 8 }}
                  aria-label="Open in Gmail"
                  title="Open in Gmail"
                >
                  <span className="hidden md:inline">Open in Gmail</span>
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M7 17L17 7" />
                    <path d="M7 7h10v10" />
                  </svg>
                </a>
              ) : (
                // iCloud: no deep link available — Message-ID isn't indexed,
                // so we can't build a `message:` URL for Mail.app. Hidden on
                // mobile to save header real estate.
                <span
                  className="hidden md:flex items-center gap-1 text-[10px] text-muted-foreground/30 px-2 py-1 cursor-not-allowed"
                  title="Direct links unavailable for iCloud"
                >
                  No web link
                </span>
              );
            })()}
            {onClose && (
              <button
                type="button"
                onClick={onClose}
                aria-label="Close email"
                className="w-6 h-6 flex items-center justify-center text-muted-foreground/50 hover:text-foreground hover:bg-white/[0.06] transition-colors"
                style={{ borderRadius: 6 }}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            )}
          </div>
        </div>
        {/* Subject is the primary identifier — promote it to the top of
            the metadata block. Truncate hard on mobile so long subjects
            can't wrap and eat two lines of header chrome. */}
        <div className="text-[13px] font-medium text-foreground leading-tight line-clamp-2 max-sm:line-clamp-1 max-sm:text-[13px]">
          {email.subject}
        </div>
        {/* From + date on one line on mobile, stacked on desktop. The
            from_address suffix is desktop-only (already implied by the
            account chip and takes a ton of width). */}
        <div className="flex items-baseline gap-2 mt-1 min-w-0 max-sm:mt-0.5">
          <span className="text-[11px] text-muted-foreground/60 truncate flex-1 min-w-0">
            {stripQuotes(email.from_name || email.from_address || email.from)}
          </span>
          <span className="text-[10px] text-muted-foreground/40 tabular-nums shrink-0">
            <span className="max-sm:hidden">{formatFullDate(dateField)}</span>
            <span className="hidden max-sm:inline">{formatCompactDate(dateField)}</span>
          </span>
        </div>
        {email.from_name && email.from_address && (
          <div className="hidden md:block text-[10px] text-muted-foreground/40 mt-0.5 truncate">
            {email.from_address}
          </div>
        )}
      </div>

      {/* Briefing triage strip — pinned above the body when present */}
      {triage && <TriageStrip triage={triage} />}

      {/* Body — fills remaining vertical space. The HTML iframe has its
          own scroll for long emails, so no outer padding/overflow here. */}
      <div className="flex-1 min-h-0 flex flex-col">
        {loading && (
          <div className="flex items-center gap-2 py-3 px-5">
            <div className="w-3.5 h-3.5 border-[1.5px] border-white/[0.06] border-t-primary rounded-full animate-spin" />
            <span className="text-[11px] text-muted-foreground/50">
              Loading email...
            </span>
          </div>
        )}
        {error && (
          <div className="text-[11px] text-destructive py-2 px-5">{error}</div>
        )}
        {!loading && !error && body && (
          isHtml ? (
            <EmailIframe html={body} />
          ) : (
            <pre className="flex-1 overflow-y-auto font-sans text-[13px] leading-relaxed text-foreground/70 whitespace-pre-wrap break-words m-0 px-5 py-4">{body}</pre>
          )
        )}
        {!loading && !error && !body && (
          <div className="text-[11px] text-muted-foreground/40 py-2 px-5">
            Email body unavailable
          </div>
        )}
      </div>

      {/* Bill pane — pinned outside the scrollable body so it stays visible
          regardless of where the user has scrolled. Renders when the email
          has pre-extracted bill data (briefing) OR when the live view
          footer toggle explicitly asked for a manual form. Mutually
          exclusive. Has its own inner scroll in case the BillBadge form
          content (searchable dropdowns, fee toggle) overflows. */}
      {!loading && email.hasBill && email.extractedBill && (
        <div
          className="shrink-0 max-h-[45%] overflow-y-auto px-5 pt-3 pb-4 max-sm:max-h-[60%] max-sm:px-3"
          style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}
        >
          <BillBadge bill={email.extractedBill} />
        </div>
      )}
      {!loading && showManualBillForm && !(email.hasBill && email.extractedBill) && (
        <div
          className="shrink-0 max-h-[45%] overflow-y-auto px-5 pt-3 pb-4 max-sm:max-h-[60%] max-sm:px-3"
          style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}
        >
          <BillBadge
            bill={{ type: "expense" }}
            emailSubject={email.subject}
            emailFrom={email.from_name || email.from}
            emailBody={body}
          />
        </div>
      )}

      {/* Footer */}
      {actions && (
        <div
          className="shrink-0 flex items-center justify-end gap-2 px-5 py-2.5"
          style={{
            borderTop: "1px solid rgba(255,255,255,0.06)",
            background: "rgba(255,255,255,0.015)",
          }}
        >
          {actions}
        </div>
      )}
    </div>
  );
}

// Pinned strip showing briefing triage signals: action tag, urgency level,
// bill flag, and the full summary sentence. Always expanded — the point is
// that this stays visible while cycling through emails so triage context
// isn't lost when reading the body.
function TriageStrip({ triage }) {
  const { action, urgency, hasBill, summary } = triage;
  const urgStyle = urgency ? urgencyStyles[urgency] : null;
  return (
    <div
      className="shrink-0 mx-5 my-3 p-3 flex items-start gap-2.5 max-sm:mx-3 max-sm:my-2 max-sm:p-2.5 max-sm:gap-2"
      style={{
        background: "rgba(249,115,22,0.05)",
        border: "1px solid rgba(249,115,22,0.18)",
        borderRadius: 8,
      }}
    >
      {/* Icon hidden on narrow screens to reclaim a full line's worth of
          horizontal space for badges + summary. */}
      <svg
        width="13"
        height="13"
        viewBox="0 0 24 24"
        fill="none"
        stroke="#f97316"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="shrink-0 mt-0.5 hidden sm:block"
      >
        <path d="M12 2L2 7l10 5 10-5-10-5z" />
        <path d="M2 17l10 5 10-5" />
        <path d="M2 12l10 5 10-5" />
      </svg>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap mb-1.5 max-sm:gap-1 max-sm:mb-1">
          <span
            className="text-[9px] font-bold uppercase tracking-wider"
            style={{ color: "#f97316" }}
          >
            Triage
          </span>
          {action && (
            <span
              className="text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded"
              style={{
                color: urgStyle?.text || "#f97316",
                background: urgStyle?.bg || "rgba(249,115,22,0.1)",
                border: `1px solid ${urgStyle?.border || "#f97316"}40`,
              }}
            >
              {action}
            </span>
          )}
          {urgency && urgStyle && (
            <span
              className="text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded"
              style={{
                color: urgStyle.text,
                background: urgStyle.bg,
                border: `1px solid ${urgStyle.border}40`,
              }}
            >
              {/* Narrow screens: drop "urgency" suffix to fit — "HIGH" alone
                  is still legible given the color coding. */}
              <span className="hidden sm:inline">{urgency} urgency</span>
              <span className="sm:hidden">{urgency}</span>
            </span>
          )}
          {hasBill && (
            <span
              className="text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded inline-flex items-center gap-1"
              style={{
                color: "#a6e3a1",
                background: "rgba(166,227,161,0.08)",
                border: "1px solid rgba(166,227,161,0.25)",
              }}
            >
              <CreditCard size={10} /> Bill
            </span>
          )}
        </div>
        {summary && (
          <div className="text-[12px] text-foreground/80 leading-relaxed max-sm:text-[11px] max-sm:leading-snug">
            {summary}
          </div>
        )}
      </div>
    </div>
  );
}
