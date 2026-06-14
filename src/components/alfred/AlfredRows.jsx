// Embedded data rows for Alfred answers. Items are VERBATIM domain rows from
// the server's `rows` event (ADR 0006: cite-by-reference — never reshape or
// recompute amounts/dates beyond display formatting).
import { memo, useMemo, useState } from "react";
import { Check, CheckCircle2, Circle, CreditCard } from "lucide-react";
import {
  alfredPriorityLabel,
  formatAlfredAgo,
  formatAlfredDate,
  formatAlfredMoney,
} from "./alfredPanelModel.js";
import { resolveAlfredChipAction } from "./alfredChipActionModel.js";

const dim = "rgba(205,214,244,0.55)";
const dimmer = "rgba(205,214,244,0.4)";
const text = "#cdd6f4";

function RowShell({ onActivate, children }) {
  const [hover, setHover] = useState(false);
  const interactive = typeof onActivate === "function";
  return (
    <div
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
      onClick={interactive ? onActivate : undefined}
      onKeyDown={interactive ? (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onActivate();
        }
      } : undefined}
      onMouseEnter={interactive ? () => setHover(true) : undefined}
      onMouseLeave={interactive ? () => setHover(false) : undefined}
      style={{
        display: "flex", alignItems: "center", gap: 9, minHeight: 36,
        padding: "5px 10px", borderRadius: 9,
        background: hover ? "rgba(46,46,72,0.55)" : "rgba(36,36,58,0.4)",
        border: `1px solid ${hover ? "rgba(255,255,255,0.1)" : "rgba(255,255,255,0.04)"}`,
        cursor: interactive ? "pointer" : undefined,
        transition: "background 150ms ease-out, border-color 150ms ease-out",
      }}
    >{children}</div>
  );
}

function TitleCell({ title, sub }) {
  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ fontSize: 12, fontWeight: 500, color: text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{title}</div>
      {sub ? <div style={{ fontSize: 10, color: dimmer, marginTop: 1 }}>{sub}</div> : null}
    </div>
  );
}

function BillRow({ item, onActivate }) {
  return (
    <RowShell onActivate={onActivate}>
      <CreditCard size={13} color={dimmer} />
      <TitleCell title={item.name} sub={item.payee} />
      <span style={{ fontSize: 12, fontWeight: 600, color: text, fontVariantNumeric: "tabular-nums" }}>
        {formatAlfredMoney(item.amount)}
      </span>
      {item.paid ? (
        <span style={{
          display: "inline-flex", alignItems: "center", gap: 4, fontSize: 9.5, fontWeight: 600,
          padding: "2px 7px", borderRadius: 999, color: "#a6e3a1",
          background: "rgba(166,227,161,0.12)", border: "1px solid rgba(166,227,161,0.25)",
        }}><Check size={9} strokeWidth={3} />Paid</span>
      ) : (
        <span style={{ fontSize: 10, color: dim, fontVariantNumeric: "tabular-nums" }}>
          {formatAlfredDate(item.next_date)}
        </span>
      )}
    </RowShell>
  );
}

function EventRow({ item, accent, onActivate }) {
  return (
    <RowShell onActivate={onActivate}>
      <span style={{ width: 6, height: 6, borderRadius: 999, background: accent, flexShrink: 0 }} />
      <span style={{
        fontSize: 10.5, color: dim, fontVariantNumeric: "tabular-nums",
        fontFamily: "var(--font-mono, 'Fira Code', ui-monospace, monospace)",
        width: 56, flexShrink: 0,
      }}>{item.allDay ? "all day" : item.time}</span>
      <TitleCell title={item.title} sub={item.dayLabel} />
      <span style={{ fontSize: 10, color: dimmer }}>{item.calendarName}</span>
    </RowShell>
  );
}

function DeadlineRow({ item, onActivate }) {
  const done = !!item.completed;
  const StatusIcon = done ? CheckCircle2 : Circle;
  const priority = alfredPriorityLabel(item.priority);
  return (
    <RowShell onActivate={onActivate}>
      <StatusIcon size={13} color={done ? "#a6e3a1" : dimmer} />
      <TitleCell title={item.content ?? item.title ?? ""} sub={null} />
      {priority ? (
        <span style={{ fontSize: 9.5, fontWeight: 700, color: priority === "P1" ? "#f38ba8" : priority === "P2" ? "#fab387" : "#89b4fa" }}>
          {priority}
        </span>
      ) : null}
      <span style={{ fontSize: 10, color: dim, fontVariantNumeric: "tabular-nums" }}>
        {formatAlfredDate(item.due_date)}
      </span>
    </RowShell>
  );
}

function EmailRow({ item, onActivate }) {
  const needsAction = item.metadata?.lane === "needs_attention";
  const fromName = item.from?.name || item.from?.address || "";
  return (
    <RowShell onActivate={onActivate}>
      <span style={{
        width: 5, height: 5, borderRadius: 999, flexShrink: 0,
        background: needsAction ? "#f38ba8" : "#94e2d5",
        boxShadow: needsAction ? "0 0 6px rgba(243,139,168,0.6)" : "none",
      }} />
      <TitleCell
        title={item.subject}
        sub={`${fromName} · ${formatAlfredAgo(item.email_date)}`}
      />
    </RowShell>
  );
}

// React.memo so a completed rows-block goes inert during subsequent token
// streaming (perf audit fe-alfred::rows-chip-action-rebuilt-every-render). The
// churning prop was onActivateItem (now useCallback'd in AlfredPanel) and the
// per-render chip-action resolution + fresh per-row closures (now useMemo'd by
// items). Items are verbatim and referentially stable once a rows event lands.
export const RowsBlock = memo(function RowsBlock({ kind, items, accent, onActivateItem }) {
  const Row = { bill: BillRow, event: EventRow, deadline: DeadlineRow, email: EmailRow }[kind];
  // Resolve chip actions once per items change rather than on every render, and
  // build the per-row click closures here too. onActivate stays undefined when no
  // action resolves, preserving the original interactivity gate (non-actionable
  // rows render non-interactive). With a stable onActivateItem these closures
  // keep identical identity across renders.
  const rows = useMemo(() => (items || []).map((item, i) => {
    const action = onActivateItem ? resolveAlfredChipAction(kind, item) : null;
    return {
      key: item.id ?? item.uid ?? i,
      item,
      onActivate: action ? () => onActivateItem(action) : undefined,
    };
  }), [kind, items, onActivateItem]);
  if (!Row) return null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
      {rows.map(({ key, item, onActivate }) => (
        <Row key={key} item={item} accent={accent} onActivate={onActivate} />
      ))}
    </div>
  );
});
