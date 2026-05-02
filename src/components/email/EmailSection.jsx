import { useRef, useState, useMemo, useCallback } from "react";
import { cn } from "@/lib/utils";
import Section from "../layout/Section";
import { urgencyStyles } from "../../lib/dashboard-helpers";
import EmailRow from "./EmailRow";
import EmailReaderOverlay from "./EmailReaderOverlay";
import useEmailReaderNav from "../../hooks/email/useEmailReaderNav";
import { MotionList, MotionItem } from "../ui/motion-wrappers";
import { useDashboard } from "../../context/DashboardContext";
import { markAllEmailsAsRead, trashEmail, markEmailAsRead, markEmailAsUnread } from "../../api";
import { CheckCheck, CreditCard, History } from "lucide-react";
import useIsMobile from "../../hooks/useIsMobile";
import ContextMenu from "../ui/ContextMenu";
import { buildBriefingEmailMenu } from "./briefingEmailMenu";
import { EmailSectionAccountTabs } from "./EmailSectionAccountTabs";
import { ConfirmChip, GhostAction, MaybeSwipe } from "./EmailSectionControls";
import { EmailSectionNoiseList } from "./EmailSectionNoiseList";
import { TrashAction } from "./EmailSectionReaderActions";

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

  // Build the briefing triage strip from briefing email fields. Only present
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
      <EmailSectionAccountTabs
        emailAccounts={emailAccounts}
        activeAccount={activeAccount}
        setActiveAccount={setActiveAccount}
        setSelectedEmail={setSelectedEmail}
        setMarkAllReadError={setMarkAllReadError}
      />

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
                    className="absolute left-0 top-3 bottom-3 w-px rounded-full"
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

      <EmailSectionNoiseList
        totalNoiseCount={totalNoiseCount}
        noiseExpanded={noiseExpanded}
        setNoiseExpanded={setNoiseExpanded}
        noiseAccounts={noiseAccountsMemo}
        multiNoiseAccounts={multiNoiseAccounts}
        openNoiseInReader={openNoiseInReader}
      />

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
        onMarkedRead={markEmailRead}
        onMarkedUnread={markEmailUnread}
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
      <Section title="Email Overview" delay={delay} loaded={loaded} variant="band" style={style} className={className}>
        {content}
      </Section>
    </>
  );
}
