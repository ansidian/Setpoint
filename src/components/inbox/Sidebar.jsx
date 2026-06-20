import { useState, useEffect } from "react";
import { Inbox, Mail, Briefcase, GraduationCap, DollarSign, Layers, Send, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { LANE } from "../../lib/shell-helpers";
import { Kbd, Eyebrow } from "./primitives";
import { readSidebarCompact, writeSidebarCompact } from "./sidebarCompactStore.js";

const ACCOUNT_ICON = { Mail, Briefcase, GraduationCap, DollarSign, Inbox };


export function AccountRow({ acc, all, accent, accountId, setAccountId, totalUnread, compact }) {
  const [hover, setHover] = useState(false);
  const accKey = acc?.id || acc?.name;
  const isActive = accountId === (all ? "__all" : accKey);
  const color = all ? accent : (acc?.color || accent);
  const count = all ? totalUnread : acc?.unread;
  const Icon = ACCOUNT_ICON[acc?.icon] || (all ? Inbox : Mail);

  return (
    <button
      type="button"
      onClick={() => setAccountId(all ? "__all" : accKey)}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "flex", alignItems: "center", gap: 10,
        width: "100%", padding: "8px 10px",
        background: isActive ? `${color}12` : (hover ? "rgba(255,255,255,0.03)" : "transparent"),
        border: `1px solid ${isActive ? `${color}28` : "transparent"}`,
        borderRadius: 8, cursor: "pointer",
        fontFamily: "inherit", textAlign: "left",
        transition: "all 120ms",
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
            {all ? "All accounts" : (acc.name || acc.email)}
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
}

export function NoiseUnreadBadge({ count }) {
  if (!count) return null;
  return (
    <span
      style={{
        flexShrink: 0,
        fontSize: 9,
        fontWeight: 650,
        padding: "1px 5px",
        borderRadius: 999,
        background: "rgba(205,214,244,0.07)",
        border: "1px solid rgba(205,214,244,0.12)",
        color: "rgba(205,214,244,0.58)",
        fontVariantNumeric: "tabular-nums",
        whiteSpace: "nowrap",
      }}
    >
      {count} unread
    </span>
  );
}

export function LaneRow({ laneKey, lane, setLane, laneCounts, noiseUnreadCount = 0 }) {
  const [hover, setHover] = useState(false);
  const L = LANE[laneKey];
  const isActive = lane === laneKey;
  const count = laneCounts[laneKey] || 0;

  return (
    <button
      type="button"
      onClick={() => setLane(laneKey)}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "flex", alignItems: "center", gap: 10,
        width: "100%", padding: "7px 10px",
        background: isActive ? L.soft : (hover ? "rgba(255,255,255,0.03)" : "transparent"),
        border: `1px solid ${isActive ? L.border : "transparent"}`,
        borderRadius: 8, cursor: "pointer",
        fontFamily: "inherit", textAlign: "left",
        transition: "all 120ms",
      }}
    >
      <span
        style={{
          width: 3, height: 16, flexShrink: 0, borderRadius: 2,
          background: L.color, opacity: isActive ? 1 : 0.6,
          boxShadow: isActive ? `0 0 8px ${L.color}60` : "none",
        }}
      />
      <span
        style={{
          flex: 1, fontSize: 12, fontWeight: 500,
          color: isActive ? "#fff" : "rgba(205,214,244,0.75)",
        }}
      >
        {L.label}
      </span>
      <span
        style={{
          fontSize: 10, fontWeight: 600, padding: "1px 6px", borderRadius: 4,
          background: "rgba(255,255,255,0.04)", color: "var(--color-text-faint)",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {count}
      </span>
      {laneKey === "noise" && <NoiseUnreadBadge count={noiseUnreadCount} />}
    </button>
  );
}

export function LaneAll({ accent, lane, setLane, laneCounts }) {
  const [hover, setHover] = useState(false);
  const isActive = lane === "__all";
  const count = (laneCounts.needs_attention || laneCounts.action || 0)
    + (laneCounts.queued || 0)
    + (laneCounts.carryover || 0)
    + (laneCounts.catch_up || 0)
    + (laneCounts.fyi || 0)
    + (laneCounts.noise || 0);
  return (
    <button
      type="button"
      onClick={() => setLane("__all")}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "flex", alignItems: "center", gap: 10,
        width: "100%", padding: "7px 10px",
        background: isActive ? `${accent}1a` : (hover ? "rgba(255,255,255,0.03)" : "transparent"),
        border: `1px solid ${isActive ? `${accent}40` : "transparent"}`,
        borderRadius: 8, cursor: "pointer",
        fontFamily: "inherit", textAlign: "left",
        transition: "all 120ms",
      }}
    >
      <Layers size={13} color={isActive ? accent : "rgba(205,214,244,0.6)"} />
      <span
        style={{
          flex: 1, fontSize: 12, fontWeight: 500,
          color: isActive ? "#fff" : "rgba(205,214,244,0.75)",
        }}
      >
        Everything
      </span>
      <span
        style={{
          fontSize: 10, fontWeight: 600, padding: "1px 6px", borderRadius: 4,
          background: "rgba(255,255,255,0.04)", color: "var(--color-text-faint)",
        }}
      >
        {count}
      </span>
    </button>
  );
}

function CollapseButton({ accent, compact, onToggle }) {
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);
  const Icon = compact ? PanelLeftOpen : PanelLeftClose;
  const lift = hover || focus;
  return (
    <button type="button" onClick={onToggle}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      onFocus={() => setFocus(true)} onBlur={() => setFocus(false)}
      aria-label={compact ? "Expand sidebar" : "Collapse sidebar"}
      title={compact ? "Expand sidebar" : "Collapse sidebar"}
      style={{ display: "flex", alignItems: "center", justifyContent: compact ? "center" : "flex-end", width: "100%", padding: "4px 6px", background: lift ? "rgba(255,255,255,0.05)" : "transparent", border: "1px solid transparent", borderRadius: 8, cursor: "pointer", color: lift ? accent : "rgba(205,214,244,0.6)", transform: lift ? "translateY(-1px)" : "translateY(0)", transition: "background 120ms, color 120ms, transform 120ms", fontFamily: "inherit" }}>
      <Icon size={15} />
    </button>
  );
}

export default function Sidebar({
  accent, accounts, accountId, setAccountId,
  lane, setLane, laneCounts, totalUnread, noiseUnreadCount = 0,
  onOpenDashboard, selectedEmail = null, readOnly = false,
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
        background: "rgba(24,24,37,0.35)",
        overflow: "hidden",
        transition: "width 180ms ease",
      }}
    >
      <CollapseButton accent={accent} compact={compact} onToggle={() => setCompact((v) => !v)} />
      <button
        type="button"
        onClick={onOpenDashboard}
        title="Back to dashboard"
        style={{
          display: "flex", alignItems: "center", justifyContent: compact ? "center" : "flex-start",
          gap: 8, padding: compact ? "10px" : "10px 12px",
          background: `linear-gradient(135deg, ${accent}30, ${accent}15)`,
          border: `1px solid ${accent}55`,
          borderRadius: 10, color: accent, cursor: "pointer",
          fontFamily: "inherit", fontSize: 12, fontWeight: 600,
          boxShadow: `0 4px 12px ${accent}10, inset 0 1px 0 rgba(255,255,255,0.08)`,
        }}
      >
        <Send size={13} />
        {!compact && <span>Open dashboard</span>}
        {!compact && <span style={{ marginLeft: "auto" }}><Kbd>1</Kbd></span>}
      </button>

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
        <div>
          <Eyebrow style={{ padding: "0 10px 8px" }}>Triage lanes</Eyebrow>
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <LaneAll accent={accent} lane={lane} setLane={setLane} laneCounts={laneCounts} />
            <LaneRow laneKey="queued" lane={lane} setLane={setLane} laneCounts={laneCounts} />
            <LaneRow laneKey="carryover" lane={lane} setLane={setLane} laneCounts={laneCounts} />
            <LaneRow laneKey="needs_attention" lane={lane} setLane={setLane} laneCounts={laneCounts} />
            <LaneRow laneKey="catch_up" lane={lane} setLane={setLane} laneCounts={laneCounts} />
            <LaneRow laneKey="fyi" lane={lane} setLane={setLane} laneCounts={laneCounts} />
            <LaneRow laneKey="handled" lane={lane} setLane={setLane} laneCounts={laneCounts} />
            <LaneRow laneKey="untriaged_read" lane={lane} setLane={setLane} laneCounts={laneCounts} />
            <LaneRow laneKey="noise" lane={lane} setLane={setLane} laneCounts={laneCounts} noiseUnreadCount={noiseUnreadCount} />
          </div>
        </div>
      )}

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

function ShortcutRow({ keys, label }) {
  return (
    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
      {keys.map((key) => <Kbd key={key}>{key}</Kbd>)}
      <span>{label}</span>
    </div>
  );
}

function buildShortcutRows(selectedEmail, readOnly) {
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
