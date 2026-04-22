import { useRef, useState, useMemo, useCallback } from "react";
import { cn } from "@/lib/utils";
import Section from "../layout/Section";
import { urgencyStyles } from "../../lib/dashboard-helpers";
import EmailRow from "./EmailRow";
import EmailReaderOverlay from "./EmailReaderOverlay";
import useEmailReaderNav from "../../hooks/email/useEmailReaderNav";
import { MotionExpand, MotionChevron, MotionList, MotionItem } from "../ui/motion-wrappers";
import { useDashboard } from "../../context/DashboardContext";
import { markAllEmailsAsRead, trashEmail, markEmailAsRead, markEmailAsUnread } from "../../api";
import { CheckCheck, CreditCard, History } from "lucide-react";
import { Icon } from "@/lib/icons.jsx";
import useIsMobile from "../../hooks/useIsMobile";
import SwipeToReveal from "../ui/SwipeToReveal";
import ContextMenu from "../ui/ContextMenu";

function MaybeSwipe({ isMobile, onAction, children }) {
  if (!isMobile) return children;
  return <SwipeToReveal onAction={onAction}>{children}</SwipeToReveal>;
}

function buildBriefingEmailMenu(email, { onOpen, onMarkRead, onMarkUnread, onDismiss, onTrash }) {
  const isRead = !!email.read;
  return [
    { label: "Open", onSelect: onOpen },
    isRead
      ? { label: "Mark unread", onSelect: onMarkUnread }
      : { label: "Mark read", onSelect: onMarkRead },
    { type: "separator" },
    {
      label: "Remove",
      children: [
        { label: "Dismiss", onSelect: onDismiss },
        { label: "Trash", danger: true, onSelect: onTrash },
      ],
    },
  ];
}

// Reusable ghost button — eliminates duplicated inline hover handlers
function GhostAction({ onClick, disabled, children, className: cls, active }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "text-[10px] max-sm:text-xs font-medium rounded-md px-2.5 py-1.5 cursor-pointer transition-all duration-150 font-[inherit]",
        active
          ? "text-primary bg-primary/[0.08] border border-primary/20 hover:bg-primary/[0.15] hover:border-primary/30"
          : "text-muted-foreground/40 bg-white/[0.02] border border-white/[0.06] hover:bg-white/[0.05] hover:border-white/10",
        "disabled:opacity-50 disabled:pointer-events-none",
        cls,
      )}
    >
      {children}
    </button>
  );
}

// Overlay footer action: two-step Trash confirm. State is owned by the
// parent so it resets when the user cycles to a new email via ↑/↓.
function TrashAction({ email, state, setState, onDismiss }) {
  if (!email) return null;
  if (state === "trashing") {
    return <span className="text-[10px] text-muted-foreground/30">Moving to trash…</span>;
  }
  if (state === "confirm") {
    return (
      <div className="flex items-center gap-2">
        <span className="text-[10px] text-muted-foreground/40">Move to trash?</span>
        <button
          onClick={async () => {
            setState("trashing");
            try {
              await trashEmail(email.uid || email.id);
              onDismiss?.(email.id || email.uid);
            } catch {
              setState("idle");
            }
          }}
          className="text-[10px] font-semibold rounded-md px-2.5 py-1 cursor-pointer font-[inherit] transition-all duration-150 hover:brightness-125"
          style={{ color: "#f38ba8", background: "rgba(243,139,168,0.1)", border: "1px solid rgba(243,139,168,0.2)" }}
        >
          Trash
        </button>
        <button
          onClick={() => setState("idle")}
          className="text-[10px] text-muted-foreground/40 bg-transparent border-none cursor-pointer p-0 font-[inherit] transition-colors duration-150 hover:text-muted-foreground/60"
        >
          Cancel
        </button>
      </div>
    );
  }
  return (
    <button
      onClick={() => setState("confirm")}
      className="flex items-center gap-1.5 text-[10px] font-medium text-muted-foreground/50 bg-transparent border border-white/[0.06] rounded-md px-2.5 py-1 cursor-pointer transition-colors duration-150 hover:text-[#f38ba8] hover:border-[#f38ba8]/30"
    >
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 6h18" /><path d="M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2" /><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
      </svg>
      Trash
    </button>
  );
}

// Inline confirm chip — used for dismiss confirmations
function ConfirmChip({ label, color, onConfirm, onCancel }) {
  return (
    <div onClick={(e) => e.stopPropagation()} className="flex items-center gap-1.5">
      <button
        className="rounded-md text-[10px] max-sm:text-xs font-semibold px-2.5 py-1 cursor-pointer font-[inherit] transition-all duration-150 hover:brightness-125"
        style={{ color, background: `${color}12`, border: `1px solid ${color}25` }}
        onClick={onConfirm}
      >{label}</button>
      <button
        className="bg-transparent border-none text-muted-foreground/30 cursor-pointer p-1 leading-none rounded transition-colors duration-150 hover:text-muted-foreground/60 hover:bg-white/[0.04]"
        onClick={onCancel}
      >
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </div>
  );
}

export default function EmailSection({ summary, model: _model, loaded, delay, style, className, embedded, active = true }) {
  const isMobile = useIsMobile();
  const {
    emailAccounts, currentAccount,
    activeAccount, setActiveAccount,
    selectedEmail, setSelectedEmail,
    confirmDismissId, setConfirmDismissId, handleDismiss: onDismiss,
    markEmailRead, markEmailUnread,
    setLoadingBillId, emailSectionRef, totalNoiseCount,
  } = useDashboard();

  const emailRowRefs = useRef({});
  const [noiseExpanded, setNoiseExpanded] = useState(false);
  const [openNoise, setOpenNoise] = useState(null);
  const [markingAllRead, setMarkingAllRead] = useState(false);
  const [markAllReadError, setMarkAllReadError] = useState("");
  const [emailMenu, setEmailMenu] = useState(null); // { email, x, y }

  const hasUnread = currentAccount?.important?.some(e => !e.read);

  // Enrich the currently selected briefing email with account metadata so
  // EmailReader can render the account chip/label/icon. The dashboard list
  // shape keeps account info on the parent account, not on each email.
  const enrichedSelectedEmail = useMemo(() => {
    if (!selectedEmail) return null;
    const acct = emailAccounts.find((a) =>
      a.important?.some((e) => e.id === selectedEmail.id),
    ) || currentAccount;
    // Only overlay account fields when the email itself is missing them —
    // briefing-account objects don't carry account_id/account_email, so
    // unconditional override would clobber the values stored on the email.
    return {
      ...selectedEmail,
      account_label: selectedEmail.account_label || acct?.name,
      account_email: selectedEmail.account_email || acct?.email,
      account_color: selectedEmail.account_color || acct?.color,
      account_icon: selectedEmail.account_icon || acct?.icon,
      account_id: selectedEmail.account_id || acct?.account_id || acct?.id,
    };
  }, [selectedEmail, emailAccounts, currentAccount]);

  // Flat list that ↑/↓ cycles through in the reader overlay — scoped to the
  // active account tab so navigation stays within the user's current view.
  const navList = currentAccount?.important || [];

  const openEmailInReader = useCallback((email) => {
    setSelectedEmail(email);
  }, [setSelectedEmail]);

  const closeReader = useCallback(() => {
    setSelectedEmail(null);
    setLoadingBillId(null);
  }, [setSelectedEmail, setLoadingBillId]);

  // Portals escape display:none on a parent, so when EmailTabSection hides
  // this section via the display-swap, the overlay would otherwise float
  // over the sibling Live tab. The overlay render below uses `active` in
  // its open condition — we intentionally keep selectedEmail/openNoise state
  // alive across tab switches so the reader reopens where you left off.

  const readerNav = useEmailReaderNav({
    list: navList,
    openEmail: selectedEmail,
    onOpen: openEmailInReader,
  });

  // ←/→ switch account tabs and open the first email in that tab
  const accountNav = useMemo(() => {
    if (emailAccounts.length <= 1) return null;
    const switchTo = (i) => {
      setActiveAccount(i);
      const first = emailAccounts[i]?.important?.[0] || null;
      setSelectedEmail(first);
    };
    const findNonEmpty = (start, step) => {
      for (let i = start; i >= 0 && i < emailAccounts.length; i += step) {
        if (emailAccounts[i]?.important?.length) return i;
      }
      return -1;
    };
    const prevIdx = findNonEmpty(activeAccount - 1, -1);
    const nextIdx = findNonEmpty(activeAccount + 1, 1);
    return {
      onPrev: prevIdx >= 0 ? () => switchTo(prevIdx) : null,
      onNext: nextIdx >= 0 ? () => switchTo(nextIdx) : null,
    };
  }, [emailAccounts, activeAccount, setActiveAccount, setSelectedEmail]);

  // Build the Claude triage strip from briefing email fields. Only present
  // when there's actually something to show.
  const readerTriage = useMemo(() => {
    if (!enrichedSelectedEmail) return null;
    const { action, urgency, hasBill, preview } = enrichedSelectedEmail;
    if (!action && !urgency && !hasBill && !preview) return null;
    return { action, urgency, hasBill, summary: preview };
  }, [enrichedSelectedEmail]);


  // Trash action for the overlay footer. Two-step confirm lives in local
  // state, keyed by email id so it auto-resets when the user cycles via ↑/↓.
  // Storing the id alongside the state avoids a cascading setState effect.
  const [trashState, setTrashState] = useState({ id: null, value: "idle" }); // value: idle | confirm | trashing
  const currentTrashState =
    trashState.id === selectedEmail?.id ? trashState.value : "idle";
  const setCurrentTrashState = useCallback(
    (value) => setTrashState({ id: selectedEmail?.id, value }),
    [selectedEmail?.id],
  );

  const readerActions = selectedEmail ? (
    <TrashAction
      email={enrichedSelectedEmail}
      state={currentTrashState}
      setState={setCurrentTrashState}
      onDismiss={(id) => {
        onDismiss(id);
        setSelectedEmail(null);
      }}
    />
  ) : null;

  // --- Noise drawer overlay wiring ---
  // Build a flat list of noise emails across all accounts so ↑/↓ can cycle
  // through them once the drawer opens. Each entry carries account metadata
  // inline so the reader chip renders correctly without extra lookups.
  const noiseAccountsMemo = useMemo(
    () => emailAccounts.filter((acc) => acc.noise?.length),
    [emailAccounts],
  );
  const flatNoise = useMemo(
    () =>
      noiseAccountsMemo.flatMap((acc, i) =>
        acc.noise.map((n, j) => ({
          ...n,
          uid: n.uid || n.id || `noise-${i}-${j}`,
          account_label: acc.name,
          account_email: acc.email,
          account_color: acc.color,
          account_icon: acc.icon,
          account_id: acc.account_id || acc.id,
        })),
      ),
    [noiseAccountsMemo],
  );

  const openNoiseInReader = useCallback((noiseEmail, acct) => {
    setOpenNoise({
      ...noiseEmail,
      uid: noiseEmail.uid || noiseEmail.id,
      account_label: acct.name,
      account_email: acct.email,
      account_color: acct.color,
      account_icon: acct.icon,
      account_id: acct.account_id || acct.id,
    });
  }, []);

  const closeNoise = useCallback(() => setOpenNoise(null), []);

  const noiseNav = useEmailReaderNav({
    list: flatNoise,
    openEmail: openNoise,
    onOpen: setOpenNoise,
  });

  const handleMarkAllRead = async () => {
    const uids = currentAccount.important.map(e => e.uid || e.id);
    if (!uids.length) return;
    setMarkingAllRead(true);
    setMarkAllReadError("");
    try {
      const result = await markAllEmailsAsRead(uids);
      const updatedUids = Array.isArray(result?.updatedUids) && result.updatedUids.length
        ? result.updatedUids
        : uids;
      updatedUids.forEach((uid) => markEmailRead(uid));

      const failedEntries = Array.isArray(result?.failed) ? result.failed : [];
      const failedCount = failedEntries.reduce((sum, entry) => sum + (entry.uids?.length || 0), 0);
      if (failedCount > 0) {
        setMarkAllReadError(
          `Marked ${updatedUids.length} email${updatedUids.length === 1 ? "" : "s"} read, but ${failedCount} could not be updated.`,
        );
      }
    } catch (err) {
      setMarkAllReadError(err.message || "Failed to mark emails as read.");
    }
    setMarkingAllRead(false);
  };

  const multiNoiseAccounts = noiseAccountsMemo.length > 1;

  const content = (
    <>
      <p className="text-[12px] text-muted-foreground/60 m-0 mb-4 leading-relaxed">
        {summary || "No email accounts connected."}
      </p>
      <div className="flex gap-1.5 mb-4 flex-wrap">
        {emailAccounts.map((acc, i) => {
          const isActive = activeAccount === i;
          return (
            <button
              key={i}
              onClick={() => {
                setActiveAccount(i);
                setSelectedEmail(null);
                setMarkAllReadError("");
              }}
              className="rounded-lg px-3 py-2 cursor-pointer flex items-center gap-2 transition-all duration-200"
              style={{
                background: isActive ? `${acc.color}12` : "rgba(255,255,255,0.02)",
                border: isActive ? `1px solid ${acc.color}30` : "1px solid rgba(255,255,255,0.04)",
              }}
            >
              <span className="flex items-center" style={{ color: isActive ? acc.color : "rgba(205,214,244,0.5)" }}><Icon name={acc.icon} size={14} /></span>
              <span
                className="text-[11px] max-sm:text-xs font-medium"
                style={{ color: isActive ? `${acc.color}dd` : "rgba(205,214,244,0.5)" }}
              >
                {acc.name}
              </span>
              <span
                className="text-[10px] max-sm:text-xs font-bold px-1.5 py-0.5 rounded-full tabular-nums"
                style={{
                  background: `${acc.color}15`,
                  color: `${acc.color}${isActive ? "cc" : "80"}`,
                }}
              >
                {acc.unread}
              </span>
            </button>
          );
        })}
      </div>

      {/* Batch actions — contextual row above the email list */}
      {currentAccount.important.length > 0 && (
        <>
          <div className="mb-3 flex items-center gap-1.5">
            {(() => {
              const carriedOver = currentAccount.important.filter(e => (e.seenCount || 1) >= 2);
              if (!carriedOver.length) return null;
              return (
                <GhostAction onClick={() => carriedOver.forEach(e => onDismiss(e.id))}>
                  Dismiss {carriedOver.length} carried-over
                </GhostAction>
              );
            })()}
            <GhostAction onClick={handleMarkAllRead} disabled={markingAllRead} active={hasUnread}>
              <CheckCheck size={11} className="inline -mt-px" />
              {markingAllRead ? " Marking…" : " Mark all read"}
            </GhostAction>
          </div>
          {markAllReadError ? (
            <div className="mb-3 text-[10px] leading-relaxed text-[#f5c2e7]">
              {markAllReadError}
            </div>
          ) : null}
        </>
      )}

      <MotionList className="flex flex-col gap-1.5" loaded={loaded} delay={delay + 100} stagger={0.04}>
        {currentAccount.important.map((email) => {
          const s = urgencyStyles[email.urgency] || urgencyStyles.low;
          const isCarriedOver = (email.seenCount || 1) >= 2;
          const isRead = !!email.read;
          return (
            <MotionItem key={email.id}>
              <MaybeSwipe isMobile={isMobile} onAction={() => onDismiss(email.id)}>
              <EmailRow
                email={email}
                dimmed={isCarriedOver || isRead}
                onOpen={openEmailInReader}
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setEmailMenu({ email, x: e.clientX, y: e.clientY });
                }}
                rowRef={(el) => { emailRowRefs.current[email.id] = el; }}
                preview={email.preview}
                accentBar={
                  <div
                    className="absolute left-0 top-3 bottom-3 w-[3px] rounded-full"
                    style={{
                      background: s.dot,
                      opacity: isCarriedOver ? 0.3 : 0.7,
                      boxShadow: isCarriedOver ? "none" : `0 0 6px ${s.dot}30`,
                    }}
                  />
                }
                desktopAfterFrom={
                  <>
                    {isCarriedOver && (
                      <span className="text-[10px] text-muted-foreground/40 inline-flex items-center gap-1">
                        <History size={10} /> previous
                      </span>
                    )}
                    {email.hasBill && (
                      <span
                        className="text-[9px] font-bold tracking-wide px-1.5 py-0.5 rounded uppercase inline-flex items-center gap-1"
                        style={{ color: "#a6e3a1cc", background: "rgba(166,227,161,0.08)" }}
                      >
                        <CreditCard size={10} /> Bill
                      </span>
                    )}
                  </>
                }
                mobileMeta={
                  <>
                    {isCarriedOver && (
                      <span className="inline-flex items-center text-muted-foreground/40"><History size={12} /></span>
                    )}
                    {email.hasBill && (
                      <span className="inline-flex items-center" style={{ color: "#a6e3a1cc" }}><CreditCard size={12} /></span>
                    )}
                    {email.action && (
                      <span
                        className="text-xs font-semibold uppercase px-1.5 py-0.5 rounded-md"
                        style={{ color: s.text, background: s.bg }}
                      >
                        {email.action}
                      </span>
                    )}
                  </>
                }
                desktopActions={
                  <>
                    {confirmDismissId === email.id ? (
                      <ConfirmChip
                        label="Dismiss"
                        color="#a6adc8"
                        onConfirm={() => { onDismiss(email.id); setConfirmDismissId(null); }}
                        onCancel={() => setConfirmDismissId(null)}
                      />
                    ) : (
                      <button
                        className={cn(
                          "transition-all duration-150 bg-transparent border-none cursor-pointer text-muted-foreground/20 p-1 leading-none rounded hover:text-muted-foreground/60 hover:bg-white/[0.04]",
                          isCarriedOver ? "opacity-100" : "opacity-0 group-hover:opacity-100",
                        )}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (isCarriedOver) onDismiss(email.id);
                          else setConfirmDismissId(email.id);
                        }}
                        title="Dismiss from briefing"
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                        </svg>
                      </button>
                    )}
                    {email.action && (
                      <div
                        className="text-[9px] font-semibold tracking-wider uppercase rounded-md whitespace-nowrap px-2 py-1"
                        style={{
                          color: s.text,
                          background: s.bg,
                          border: `1px solid ${s.border}20`,
                        }}
                      >
                        {email.action}
                      </div>
                    )}
                    {email.urgentFlag && (
                      <div
                        className="text-[9px] font-semibold tracking-wide rounded-md whitespace-nowrap px-2 py-1 flex items-center gap-1"
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
                    )}
                  </>
                }
                hideUrgentFlag
              />
              </MaybeSwipe>
            </MotionItem>
          );
        })}
      </MotionList>

      {/* Noise drawer */}
      {totalNoiseCount > 0 && (
        <div className="mt-3">
          <GhostAction
            onClick={() => setNoiseExpanded(!noiseExpanded)}
            className="w-full flex items-center justify-between"
          >
            <span>{totalNoiseCount} email{totalNoiseCount !== 1 ? "s" : ""} filtered as noise</span>
            <MotionChevron isOpen={noiseExpanded} className="text-muted-foreground/25" />
          </GhostAction>
          <MotionExpand isOpen={noiseExpanded}>
            <div
              className="rounded-lg mt-1.5 py-3 px-4"
              style={{ background: "rgba(36,36,58,0.25)", border: "1px solid rgba(255,255,255,0.04)" }}
            >
              {noiseAccountsMemo.map((acc, i) => (
                <div key={i} className={i > 0 ? "mt-3 pt-3 border-t border-white/[0.04]" : ""}>
                  {multiNoiseAccounts && (
                    <div className="flex items-center gap-1.5 mb-1.5">
                      <span
                        className="inline-block w-1.5 h-1.5 rounded-full shrink-0"
                        style={{ background: acc.color, opacity: 0.7 }}
                      />
                      <span className="text-[10px] max-sm:text-xs font-medium text-muted-foreground/40">{acc.name}</span>
                    </div>
                  )}
                  <div className="flex flex-col">
                    {acc.noise.map((noiseEmail, j) => {
                      const noiseId = noiseEmail.id || `noise-${i}-${j}`;
                      return (
                        <div
                          key={noiseId}
                          role="button"
                          tabIndex={0}
                          onClick={() => openNoiseInReader(noiseEmail, acc)}
                          className="flex items-center gap-2 min-w-0 py-1.5 px-1 rounded cursor-pointer hover:bg-white/[0.04] transition-colors duration-150"
                        >
                          <span className="text-[11px] max-sm:text-xs text-muted-foreground/35 shrink-0 min-w-[80px] max-w-[140px] truncate">{noiseEmail.from}</span>
                          <span className="text-[11px] max-sm:text-xs text-muted-foreground/55 truncate flex-1">{noiseEmail.subject}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </MotionExpand>
        </div>
      )}

      {/* Focus reader overlay — briefing list */}
      <EmailReaderOverlay
        open={active && !!selectedEmail}
        email={enrichedSelectedEmail}
        onClose={closeReader}
        navigation={readerNav}
        accountNav={accountNav}
        triage={readerTriage}
        actions={readerActions}
        onMarkedRead={markEmailRead}
        onMarkedUnread={markEmailUnread}
        onLoaded={() => {
          setLoadingBillId(null);
          // Scroll the originating row into view if it's off-screen, so
          // closing the reader doesn't leave the user orphaned at the top.
          if (!selectedEmail) return;
          const row = emailRowRefs.current[selectedEmail.id];
          if (!row) return;
          const rect = row.getBoundingClientRect();
          if (rect.bottom > window.innerHeight || rect.top < 0) {
            row.scrollIntoView({ behavior: "smooth", block: "nearest" });
          }
        }}
      />

      {/* Focus reader overlay — noise drawer */}
      <EmailReaderOverlay
        open={active && !!openNoise}
        email={openNoise}
        onClose={closeNoise}
        navigation={noiseNav}
      />

      {emailMenu && (
        <ContextMenu
          x={emailMenu.x}
          y={emailMenu.y}
          onClose={() => setEmailMenu(null)}
          items={buildBriefingEmailMenu(emailMenu.email, {
            onOpen: () => openEmailInReader(emailMenu.email),
            onMarkRead: async () => {
              const key = emailMenu.email.uid || emailMenu.email.id;
              markEmailRead(key);
              try { await markEmailAsRead(key); } catch { /* ignore */ }
            },
            onMarkUnread: async () => {
              const key = emailMenu.email.uid || emailMenu.email.id;
              markEmailUnread(key);
              try { await markEmailAsUnread(key); } catch { /* ignore */ }
            },
            onDismiss: () => onDismiss(emailMenu.email.id),
            onTrash: async () => {
              const key = emailMenu.email.uid || emailMenu.email.id;
              try { await trashEmail(key); } catch { /* ignore */ }
              onDismiss(emailMenu.email.id);
            },
          })}
        />
      )}
    </>
  );

  if (embedded) return content;

  return (
    <>
      <div ref={emailSectionRef} />
      <Section title="Email Overview" delay={delay} loaded={loaded} style={style} className={className}>
        {content}
      </Section>
    </>
  );
}
