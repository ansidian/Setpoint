import { useEffect, useRef, useState } from "react";
import {
  ArrowRightLeft,
  BellOff,
  BellPlus,
  CalendarX,
  Check,
  CheckCircle2,
  Clock,
  CreditCard,
  ExternalLink,
  FileText,
  ListChecks,
  Mail,
  MailOpen,
  Pin,
  Sparkles,
  Trash2,
  X,
  Zap,
} from "lucide-react";
import type { CSSProperties, RefObject } from "react";
import type { LucideIcon } from "lucide-react";
import type { InboxActionDispatcher } from "../useInboxActionDispatch";
import type { ReaderMoveDestination, ReaderTriageItem } from "./readerActionsModel";
import AnchoredFloatingPanel from "../../shared/pickers/AnchoredFloatingPanel";
import SnoozePicker from "../SnoozePicker";
import Tooltip from "../../shared/Tooltip";
import "./DesktopReaderActionBar.css";

type BillAction = {
  label: string;
  primary: boolean;
  actioned: boolean;
  onClick: () => void;
};

export type DesktopReaderActionBarProps = {
  accent: string;
  moveDestinations: ReaderMoveDestination[];
  moveDisabled: boolean;
  triageItems: ReaderTriageItem[];
  billAction: BillAction | null;
  gmailUrl: string | null;
  showTrash: boolean;
  onAction: InboxActionDispatcher;
  onClose: () => void;
  onRemind?: () => void;
  reminderOpen?: boolean;
  onAskAlfred?: () => void;
  snoozeAnchorRef: RefObject<HTMLButtonElement | null>;
  snoozeOpen: boolean;
  setSnoozeOpen: (open: boolean) => void;
};

type ToolbarButtonProps = {
  icon: LucideIcon;
  label?: string;
  ariaLabel?: string;
  tooltip?: string;
  onClick: () => void;
  buttonRef?: RefObject<HTMLButtonElement | null>;
  adaptive?: boolean;
  primary?: boolean;
  danger?: boolean;
  disabled?: boolean;
  keyHint?: string;
  expanded?: boolean;
  popup?: "menu";
  accent?: string;
  suspendHotkeys?: boolean;
};

function ToolbarButton({
  icon: Icon,
  label,
  ariaLabel,
  tooltip,
  onClick,
  buttonRef,
  adaptive = false,
  primary = false,
  danger = false,
  disabled = false,
  keyHint,
  expanded,
  popup,
  accent,
  suspendHotkeys = false,
}: ToolbarButtonProps) {
  const button = (
    <button
      ref={buttonRef}
      type="button"
      className="desktop-reader-action-button"
      aria-label={ariaLabel || label || tooltip}
      aria-expanded={expanded}
      aria-haspopup={popup}
      data-adaptive={adaptive ? "true" : undefined}
      data-primary={primary ? "true" : undefined}
      data-danger={danger ? "true" : undefined}
      data-icon-only={!label ? "true" : undefined}
      data-suspend-inbox-hotkeys={suspendHotkeys ? "true" : undefined}
      disabled={disabled}
      onClick={onClick}
      style={accent ? ({ "--reader-action-color": accent } as CSSProperties) : undefined}
    >
      <Icon size={13} aria-hidden="true" />
      {label && <span className="desktop-reader-action-label">{label}</span>}
      {keyHint && <span className="desktop-reader-action-key" aria-hidden="true">{keyHint}</span>}
    </button>
  );

  if (!tooltip) return button;
  return (
    <Tooltip text={tooltip} side="bottom" sideOffset={8}>
      {button}
    </Tooltip>
  );
}

function moveIcon(lane: ReaderMoveDestination["lane"]): LucideIcon {
  if (lane === "needs_attention") return Zap;
  if (lane === "fyi") return FileText;
  return BellOff;
}

function triageIcon(key: ReaderTriageItem["key"]): LucideIcon {
  if (key === "snapshot-reopen" || key === "snapshot-handled") return Check;
  if (key === "snapshot-dismiss") return CalendarX;
  if (key === "snooze") return Clock;
  if (key === "pin-toggle") return Pin;
  return MailOpen;
}

function MenuItem({
  icon: Icon,
  label,
  keyHint,
  active = false,
  disabled = false,
  onSelect,
}: {
  icon: LucideIcon;
  label: string;
  keyHint: string | null;
  active?: boolean;
  disabled?: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      className="desktop-reader-action-menu-item"
      data-active={active ? "true" : undefined}
      disabled={disabled}
      onClick={onSelect}
    >
      <Icon size={13} aria-hidden="true" />
      <span className="desktop-reader-action-menu-label">{label}</span>
      {active && <Check size={12} color="var(--sp-accent)" aria-hidden="true" />}
      {keyHint && <span className="desktop-reader-action-key desktop-reader-action-menu-key" aria-hidden="true">{keyHint}</span>}
    </button>
  );
}

function focusMenuItem(panel: HTMLDivElement | null, offset: number) {
  const items = Array.from(panel?.querySelectorAll<HTMLButtonElement>(
    "[role='menuitem']:not(:disabled)",
  ) || []);
  if (!items.length) return;
  const current = items.indexOf(document.activeElement as HTMLButtonElement);
  const next = current < 0 ? 0 : (current + offset + items.length) % items.length;
  items[next]?.focus();
}

function MenuPanel({
  anchorRef,
  panelRef,
  ariaLabel,
  height,
  onClose,
  children,
}: {
  anchorRef: RefObject<HTMLButtonElement | null>;
  panelRef: RefObject<HTMLDivElement | null>;
  ariaLabel: string;
  height: number;
  onClose: () => void;
  children: React.ReactNode;
}) {
  useEffect(() => {
    window.queueMicrotask(() => focusMenuItem(panelRef.current, 0));
  }, [panelRef]);

  return (
    <AnchoredFloatingPanel
      anchorRef={anchorRef}
      panelRef={panelRef}
      onClose={onClose}
      width={224}
      height={height}
      role="menu"
      ariaLabel={ariaLabel}
      disableMobileSheet
      style={{ padding: 6, borderRadius: 8, background: "#16161e" }}
    >
      <div
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            focusMenuItem(panelRef.current, 1);
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            focusMenuItem(panelRef.current, -1);
          } else if (event.key === "Home") {
            event.preventDefault();
            panelRef.current?.querySelector<HTMLButtonElement>("[role='menuitem']:not(:disabled)")?.focus();
          } else if (event.key === "End") {
            event.preventDefault();
            const items = panelRef.current?.querySelectorAll<HTMLButtonElement>("[role='menuitem']:not(:disabled)");
            items?.[items.length - 1]?.focus();
          }
        }}
      >
        {children}
      </div>
    </AnchoredFloatingPanel>
  );
}

export default function DesktopReaderActionBar({
  accent,
  moveDestinations,
  moveDisabled,
  triageItems,
  billAction,
  gmailUrl,
  showTrash,
  onAction,
  onClose,
  onRemind,
  reminderOpen = false,
  onAskAlfred,
  snoozeAnchorRef,
  snoozeOpen,
  setSnoozeOpen,
}: DesktopReaderActionBarProps) {
  const [openMenu, setOpenMenu] = useState<"move" | "triage" | null>(null);
  const moveTriggerRef = useRef<HTMLButtonElement>(null);
  const movePanelRef = useRef<HTMLDivElement>(null);
  const triagePanelRef = useRef<HTMLDivElement>(null);

  const closeMenu = (menu: "move" | "triage", restoreFocus = true) => {
    setOpenMenu(null);
    if (restoreFocus) {
      const trigger = menu === "move" ? moveTriggerRef.current : snoozeAnchorRef.current;
      trigger?.focus();
    }
  };

  const selectTriage = (item: ReaderTriageItem) => {
    if (item.key === "snooze") {
      closeMenu("triage", false);
      setSnoozeOpen(true);
      return;
    }
    closeMenu("triage");
    onAction(item.key);
  };

  const closeSnooze = () => {
    setSnoozeOpen(false);
    window.queueMicrotask(() => snoozeAnchorRef.current?.focus());
  };

  const lifecycleItems = triageItems.filter((item) => item.section === "lifecycle");
  const stateItems = triageItems.filter((item) => item.section === "state");
  const hasWorkCluster = !!(onRemind || onAskAlfred || billAction);

  return (
    <div className="desktop-reader-action-bar" data-testid="desktop-reader-action-bar">
      {hasWorkCluster && (
        <div className="desktop-reader-action-cluster" data-action-cluster="work">
          {onRemind && (
            <ToolbarButton
              icon={BellPlus}
              label={reminderOpen ? "Hide reminder" : "Remind me"}
              adaptive
              expanded={reminderOpen}
              onClick={onRemind}
            />
          )}
          {onAskAlfred && (
            <ToolbarButton
              icon={Sparkles}
              label="Ask Alfred"
              adaptive
              onClick={onAskAlfred}
            />
          )}
          {billAction && (
            <ToolbarButton
              icon={billAction.actioned ? CheckCircle2 : CreditCard}
              label={billAction.label}
              adaptive
              primary={billAction.primary}
              accent="#a6e3a1"
              onClick={billAction.onClick}
            />
          )}
        </div>
      )}

      {(moveDestinations.length > 0 || triageItems.length > 0) && (
        <div className="desktop-reader-action-cluster" data-action-cluster="organize">
          {moveDestinations.length > 0 && (
            <ToolbarButton
              icon={ArrowRightLeft}
              label="Move to…"
              ariaLabel="Move to"
              adaptive
              disabled={moveDisabled}
              expanded={openMenu === "move"}
              popup="menu"
              buttonRef={moveTriggerRef}
              suspendHotkeys
              onClick={() => setOpenMenu((current) => current === "move" ? null : "move")}
            />
          )}
          {triageItems.length > 0 && (
            <ToolbarButton
              icon={ListChecks}
              label="Triage"
              adaptive
              expanded={openMenu === "triage"}
              popup="menu"
              buttonRef={snoozeAnchorRef}
              suspendHotkeys
              onClick={() => setOpenMenu((current) => current === "triage" ? null : "triage")}
            />
          )}
        </div>
      )}

      {(gmailUrl || showTrash) && (
        <div className="desktop-reader-action-cluster" data-action-cluster="utilities">
          {gmailUrl && (
            <ToolbarButton
              icon={ExternalLink}
              ariaLabel="Open in Gmail"
              tooltip="Open in Gmail"
              keyHint="O"
              accent={accent}
              onClick={() => window.open(gmailUrl, "_blank", "noopener,noreferrer")}
            />
          )}
          {showTrash && (
            <ToolbarButton
              icon={Trash2}
              ariaLabel="Trash email"
              tooltip="Trash email"
              keyHint="E"
              danger
              onClick={() => onAction("trash")}
            />
          )}
        </div>
      )}

      <div className="desktop-reader-action-close">
        <ToolbarButton icon={X} ariaLabel="Close reader" tooltip="Close" onClick={onClose} />
      </div>

      {openMenu === "move" && (
        <MenuPanel
          anchorRef={moveTriggerRef}
          panelRef={movePanelRef}
          ariaLabel="Move email"
          height={moveDestinations.length * 36 + 12}
          onClose={() => closeMenu("move")}
        >
          {moveDestinations.map((destination) => (
            <MenuItem
              key={destination.lane}
              icon={moveIcon(destination.lane)}
              label={destination.label}
              keyHint={destination.keyHint}
              onSelect={() => {
                closeMenu("move");
                onAction("snapshot-move-lane", destination.lane);
              }}
            />
          ))}
        </MenuPanel>
      )}

      {openMenu === "triage" && (
        <MenuPanel
          anchorRef={snoozeAnchorRef}
          panelRef={triagePanelRef}
          ariaLabel="Triage email"
          height={triageItems.length * 36 + (lifecycleItems.length && stateItems.length ? 11 : 0) + 12}
          onClose={() => closeMenu("triage")}
        >
          {lifecycleItems.map((item) => (
            <MenuItem
              key={item.key}
              icon={triageIcon(item.key)}
              label={item.label}
              keyHint={item.keyHint}
              active={item.active}
              disabled={item.disabled}
              onSelect={() => selectTriage(item)}
            />
          ))}
          {lifecycleItems.length > 0 && stateItems.length > 0 && (
            <div className="desktop-reader-action-menu-divider" role="separator" />
          )}
          {stateItems.map((item) => (
            <MenuItem
              key={item.key}
              icon={item.key === "toggle-read" && item.label === "Mark unread" ? Mail : triageIcon(item.key)}
              label={item.label}
              keyHint={item.keyHint}
              active={item.active}
              disabled={item.disabled}
              onSelect={() => selectTriage(item)}
            />
          ))}
        </MenuPanel>
      )}

      {snoozeOpen && (
        <SnoozePicker
          anchorRef={snoozeAnchorRef}
          onSelect={(untilTs) => onAction("snooze", untilTs)}
          onClose={closeSnooze}
        />
      )}
    </div>
  );
}
