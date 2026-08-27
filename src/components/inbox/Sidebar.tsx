import { useState, useEffect } from "react";
import type { MouseEventHandler } from "react";
import { Inbox, Mail, Briefcase, GraduationCap, DollarSign, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Kbd, Eyebrow } from "./primitives";
import Tooltip from "../shared/Tooltip";
import { readSidebarCompact, writeSidebarCompact } from "./sidebarCompactStore";
import type { InboxAccount, InboxEmailLike } from "./inboxTypes";

const ACCOUNT_ICON: Record<string, LucideIcon> = { Mail, Briefcase, GraduationCap, DollarSign, Inbox };
type SetString = (value: string) => void;


export function AccountRow({ acc, all = false, accent, accountId, setAccountId, totalUnread, compact }: {
  acc?: InboxAccount;
  all?: boolean;
  accent: string;
  accountId: string;
  setAccountId: SetString;
  totalUnread: number;
  compact: boolean;
}) {
  const [hover, setHover] = useState(false);
  const accKey = acc?.id || acc?.name || "";
  const isActive = accountId === (all ? "__all" : accKey);
  const color = all ? accent : (acc?.color || accent);
  const count = all ? totalUnread : (acc?.unread ?? 0);
  const iconKey = acc?.icon;
  const Icon = (iconKey ? ACCOUNT_ICON[iconKey] : undefined) || (all ? Inbox : Mail);
  const label = all ? "All accounts" : (acc?.name || acc?.email || "Account");

  const control = (
    <button
      type="button"
      onClick={() => setAccountId(all ? "__all" : accKey)}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      aria-label={compact ? `${label}${count > 0 ? `, ${count}` : ""}` : undefined}
      className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ea-accent)]/60 active:translate-y-0 motion-reduce:transform-none motion-reduce:transition-none"
      style={{
        position: "relative",
        display: "flex", alignItems: "center", justifyContent: compact ? "center" : "flex-start", gap: 10,
        width: "100%", minHeight: 40, padding: compact ? "8px 6px" : "8px 10px",
        background: isActive ? `${color}12` : (hover ? "rgba(255,255,255,0.03)" : "transparent"),
        border: `1px solid ${isActive ? `${color}28` : "transparent"}`,
        borderRadius: 8, cursor: "pointer",
        fontFamily: "inherit", textAlign: "left",
        transform: hover ? "translateY(-1px)" : "translateY(0)",
        transition: "background 120ms, border-color 120ms, transform 120ms",
      }}
    >
      <span
        style={{
          width: 22, height: 22, borderRadius: 6, flexShrink: 0,
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          background: `${color}18`, color,
        }}
      >
        <Icon size={12} />
      </span>
      {compact && count > 0 && (
        <span
          aria-hidden="true"
          data-testid={`sidebar-account-count-${all ? "all" : accKey}`}
          style={{
            position: "absolute",
            top: 2,
            right: 1,
            minWidth: 15,
            height: 15,
            padding: "0 3px",
            borderRadius: 999,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            background: "var(--sp-mantle)",
            border: `1px solid color-mix(in srgb, ${color} 45%, var(--sp-mantle))`,
            color,
            fontSize: 8,
            lineHeight: 1,
            fontWeight: 750,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {count > 99 ? "99+" : count}
        </span>
      )}
      {!compact && (
        <>
          <span
            style={{
              flex: "1 1 auto",
              minWidth: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              fontSize: 12, fontWeight: 500,
              color: isActive ? "#fff" : "rgba(205,214,244,0.8)",
            }}
          >
            {label}
          </span>
          {count > 0 && (
            <span
              style={{
                flexShrink: 0,
                fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 999,
                background: `${color}18`, color,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {count}
            </span>
          )}
        </>
      )}
    </button>
  );

  if (!compact) return control;
  return (
    <Tooltip text={label} side="right" sideOffset={10} delay={220} style={{ width: "100%" }}>
      {control}
    </Tooltip>
  );
}

function CollapseButton({ accent, compact, onToggle }: {
  accent: string;
  compact: boolean;
  onToggle: MouseEventHandler<HTMLButtonElement>;
}) {
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);
  const Icon = compact ? PanelLeftOpen : PanelLeftClose;
  const lift = hover || focus;
  const control = (
    <button type="button" onClick={onToggle}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      onFocus={() => setFocus(true)} onBlur={() => setFocus(false)}
      aria-label={compact ? "Expand sidebar" : "Collapse sidebar"}
      className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ea-accent)]/60 active:translate-y-0 motion-reduce:transform-none motion-reduce:transition-none"
      style={{ display: "flex", alignItems: "center", justifyContent: compact ? "center" : "flex-start", gap: 8, width: "100%", minHeight: 34, padding: compact ? "4px 6px" : "6px 10px", background: lift ? "rgba(255,255,255,0.05)" : "transparent", border: "1px solid transparent", borderRadius: 8, cursor: "pointer", color: lift ? accent : "rgba(205,214,244,0.6)", transform: lift ? "translateY(-1px)" : "translateY(0)", transition: "background 120ms, color 120ms, transform 120ms", fontFamily: "inherit", fontSize: 11, fontWeight: 600 }}>
      <Icon size={15} />
      {!compact && <span>Collapse sidebar</span>}
    </button>
  );

  if (!compact) return control;
  return (
    <Tooltip text="Expand sidebar" side="right" sideOffset={10} delay={220} style={{ width: "100%" }}>
      {control}
    </Tooltip>
  );
}

export default function Sidebar({
  accent, accounts, accountId, setAccountId,
  totalUnread, selectedEmail = null, readOnly = false,
}: {
  accent: string;
  accounts: InboxAccount[];
  accountId: string;
  setAccountId: SetString;
  totalUnread: number;
  selectedEmail?: InboxEmailLike | null;
  readOnly?: boolean;
}) {
  const [compact, setCompact] = useState(readSidebarCompact);
  useEffect(() => { writeSidebarCompact(compact); }, [compact]);

  const shortcutRows = buildShortcutRows(selectedEmail, readOnly);

  return (
    <div
      style={{
        width: compact ? 60 : 232, flexShrink: 0,
        padding: "14px 10px", display: "flex", flexDirection: "column", gap: 18,
        borderRight: "1px solid rgba(255,255,255,0.04)",
        background: "color-mix(in srgb, var(--sp-mantle) 35%, transparent)",
        overflow: "hidden",
        transition: "width 180ms ease",
      }}
    >
      <CollapseButton accent={accent} compact={compact} onToggle={() => setCompact((v) => !v)} />

      <div>
        {!compact && <Eyebrow style={{ padding: "0 10px 8px" }}>Accounts</Eyebrow>}
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <AccountRow
            all
            accent={accent}
            accountId={accountId}
            setAccountId={setAccountId}
            totalUnread={totalUnread}
            compact={compact}
          />
          {accounts.map((acc) => (
            <AccountRow
              key={acc.id || acc.name}
              acc={acc}
              accent={accent}
              accountId={accountId}
              setAccountId={setAccountId}
              totalUnread={totalUnread}
              compact={compact}
            />
          ))}
        </div>
      </div>

      {!compact && (
        <div style={{ marginTop: "auto", padding: 10 }}>
          <Eyebrow style={{ marginBottom: 8 }}>Shortcuts</Eyebrow>
          <div style={{ display: "grid", rowGap: 6, fontSize: 10, color: "var(--color-text-faint)" }}>
            {shortcutRows.map((row) => (
              <ShortcutRow key={`${row.keys.join("-")}-${row.label}`} keys={row.keys} label={row.label} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ShortcutRow({ keys, label }: { keys: string[]; label: string }) {
  return (
    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
      {keys.map((key) => <Kbd key={key}>{key}</Kbd>)}
      <span>{label}</span>
    </div>
  );
}

function buildShortcutRows(selectedEmail: InboxEmailLike | null, readOnly: boolean): Array<{ keys: string[]; label: string }> {
  const rows = [
    { keys: ["J", "K"], label: "Navigate" },
  ];

  if (selectedEmail) {
    rows.push({ keys: ["O"], label: "Open" });
  }

  if (selectedEmail && !readOnly) {
    const isSnapshot = !!selectedEmail._activeSnapshot && !!selectedEmail.snapshot_item_id;
    const isCatchUp = selectedEmail._lane === "catch_up" || selectedEmail._catchUp || selectedEmail.source === "catch_up";
    const isQueued = selectedEmail._lane === "queued";
    const isUntriagedRead = selectedEmail._lane === "untriaged_read";
    const isHandled = selectedEmail._lane === "handled";
    const snapshotLane = selectedEmail._lane === "carryover" ? "needs_attention" : selectedEmail._lane;
    const canMarkHandled = snapshotLane === "needs_attention" || snapshotLane === "fyi";

    if (isCatchUp || isUntriagedRead) {
      return rows.concat(
        { keys: ["⌘F"], label: "Find" },
        { keys: ["⌘Z"], label: "Undo" },
        { keys: ["⌘K"], label: "Command" },
      );
    } else if (isSnapshot && isQueued) {
      rows.push({ keys: ["D"], label: "Dismiss" });
    } else if (isSnapshot && isHandled) {
      rows.push({ keys: ["H"], label: "Reopen" });
    } else if (isSnapshot) {
      if (canMarkHandled) rows.push({ keys: ["H"], label: "Mark handled" });
      rows.push({ keys: ["D"], label: "Dismiss" });
      if (snapshotLane !== "needs_attention") rows.push({ keys: ["A"], label: "Move to Needs" });
      if (snapshotLane !== "fyi") rows.push({ keys: ["F"], label: "Move to FYI" });
      if (snapshotLane !== "noise") rows.push({ keys: ["N"], label: "Move to Noise" });
    }

    rows.push(
      { keys: ["S"], label: "Snooze" },
      { keys: ["E"], label: "Trash" },
    );
  }

  rows.push(
    { keys: ["⌘F"], label: "Find" },
    { keys: ["⌘Z"], label: "Undo" },
    { keys: ["⌘K"], label: "Command" },
  );

  return rows;
}
