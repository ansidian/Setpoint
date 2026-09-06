import { useEffect, useRef, useState } from "react";
import {
  BellOff,
  CalendarX,
  Check,
  Clock,
  FileText,
  ChevronLeft,
  ChevronRight,
  MoreHorizontal,
  Mail,
  MailOpen,
  Pin,
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

export type DesktopReaderActionBarProps = {
  accent: string;
  moveDestinations: ReaderMoveDestination[];
  moveDisabled: boolean;
  triageItems: ReaderTriageItem[];
  showTrash: boolean;
  onAction: InboxActionDispatcher;
  onClose: () => void;
  onPrevious?: () => void;
  onNext?: () => void;
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
  alfred?: boolean;
  suspendHotkeys?: boolean;
};

export function ToolbarButton({
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
  alfred = false,
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
      data-alfred={alfred ? "true" : undefined}
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
  showTrash,
  onAction,
  onClose,
  onPrevious,
  onNext,
  snoozeAnchorRef,
  snoozeOpen,
  setSnoozeOpen,
}: DesktopReaderActionBarProps) {
  const [moreOpen, setMoreOpen] = useState(false);
  const moreTriggerRef = useRef<HTMLButtonElement>(null);
  const morePanelRef = useRef<HTMLDivElement>(null);
  const closeMenu = () => {
    setMoreOpen(false);
    moreTriggerRef.current?.focus();
  };
  const closeSnooze = () => {
    setSnoozeOpen(false);
    window.queueMicrotask(() => snoozeAnchorRef.current?.focus());
  };
  const primaryItem = triageItems.find((item) => item.key === "snapshot-handled" || item.key === "snapshot-reopen" || item.key === "unsnooze");
  const snoozeItem = triageItems.find((item) => item.key === "snooze");
  const secondaryItems = triageItems.filter((item) => item !== primaryItem && item !== snoozeItem);
  const hasMore = moveDestinations.length > 0 || secondaryItems.length > 0 || showTrash;

  return (
    <div className="desktop-reader-action-bar" data-testid="desktop-reader-action-bar">
      <div className="desktop-reader-action-cluster">
        {primaryItem && <ToolbarButton icon={Check} label={primaryItem.label} primary accent={accent} disabled={primaryItem.disabled} onClick={() => onAction(primaryItem.key)} />}
        {snoozeItem && <ToolbarButton icon={Clock} label="Snooze" adaptive disabled={snoozeItem.disabled} buttonRef={snoozeAnchorRef} expanded={snoozeOpen} onClick={() => { setMoreOpen(false); setSnoozeOpen(!snoozeOpen); }} />}
        {hasMore && <ToolbarButton icon={MoreHorizontal} ariaLabel="More email actions" tooltip="More email actions" expanded={moreOpen} popup="menu" buttonRef={moreTriggerRef} suspendHotkeys onClick={() => { setSnoozeOpen(false); setMoreOpen((value) => !value); }} />}
      </div>
      <div className="desktop-reader-action-navigation">
        <ToolbarButton icon={ChevronLeft} ariaLabel="Previous email" tooltip="Previous email" disabled={!onPrevious} onClick={() => onPrevious?.()} />
        <ToolbarButton icon={ChevronRight} ariaLabel="Next email" tooltip="Next email" disabled={!onNext} onClick={() => onNext?.()} />
        <span className="desktop-reader-action-separator" aria-hidden="true" />
        <ToolbarButton icon={X} ariaLabel="Close reader" tooltip="Close" onClick={onClose} />
      </div>
      {moreOpen && (
        <MenuPanel
          anchorRef={moreTriggerRef}
          panelRef={morePanelRef}
          ariaLabel="More email actions"
          height={(secondaryItems.length + moveDestinations.length + Number(showTrash)) * 36 + 60}
          onClose={closeMenu}
        >
          {secondaryItems.map((item) => (
            <MenuItem key={item.key} icon={item.key === "toggle-read" && item.label === "Mark unread" ? Mail : triageIcon(item.key)} label={item.label} keyHint={item.keyHint} active={item.active} disabled={item.disabled} onSelect={() => { closeMenu(); onAction(item.key); }} />
          ))}
          {moveDestinations.length > 0 && <>
            {secondaryItems.length > 0 && <div className="desktop-reader-action-menu-divider" role="separator" />}
            <div className="desktop-reader-action-menu-heading">Move to</div>
            {moveDestinations.map((destination) => (
              <MenuItem key={destination.lane} icon={moveIcon(destination.lane)} label={destination.label} keyHint={destination.keyHint} disabled={moveDisabled} onSelect={() => { closeMenu(); onAction("snapshot-move-lane", destination.lane); }} />
            ))}
          </>}
          {showTrash && <>
            <div className="desktop-reader-action-menu-divider" role="separator" />
            <MenuItem icon={Trash2} label="Trash email" keyHint="E" onSelect={() => { closeMenu(); onAction("trash"); }} />
          </>}
        </MenuPanel>
      )}
      {snoozeOpen && <SnoozePicker anchorRef={snoozeAnchorRef} onSelect={(untilTs) => onAction("snooze", untilTs)} onClose={closeSnooze} />}
    </div>
  );
}
