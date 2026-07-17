// Embedded data rows for Alfred answers. Items are VERBATIM domain rows from
// the server's `rows` event (ADR 0006: cite-by-reference — never reshape or
// recompute amounts/dates beyond display formatting).
import { Fragment, memo, useMemo, useState } from "react";
import type { ComponentType, ReactNode } from "react";
import { Check, CheckCircle2, Circle, Clock, CreditCard, Flag, MapPin, Receipt, Video } from "lucide-react";
import {
  alfredPriorityLabel,
  formatAlfredAbsolute,
  formatAlfredAgo,
  formatAlfredDate,
  formatAlfredMoney,
} from "./alfredPanelModel";
import {
  billsTotalDue,
  deadlineDone,
  emailDotState,
  eventPassed,
  groupAlfredRows,
  isOverdueYmd,
  nextEventId,
} from "./alfredRowOrdering";
import { pacificYMD } from "../calendar/calendarDateUtils.js";
import { resolveAlfredChipAction } from "./alfredChipActionModel";
import type { AlfredChipAction } from "./alfredChipActionModel";
import type { AlfredItemKind } from "../../../shared/types/alfred";
import type { AlfredRow } from "./alfredRowOrdering";

const overdueColor = "var(--sp-rose)";

const dimmer = "rgba(205,214,244,0.4)";
const text = "var(--sp-text)";

function RowShell({ onActivate, title, dim, children }: {
  onActivate?: () => void;
  title?: string;
  dim?: boolean;
  children: ReactNode;
}) {
  const [hover, setHover] = useState(false);
  const interactive = typeof onActivate === "function";
  return (
    <div
      title={title}
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
        background: hover ? "rgba(46,46,72,0.55)" : "color-mix(in srgb, var(--sp-surface) 40%, transparent)",
        border: `1px solid ${hover ? "rgba(255,255,255,0.1)" : "rgba(255,255,255,0.04)"}`,
        cursor: interactive ? "pointer" : undefined,
        opacity: dim ? 0.5 : 1,
        transition: "background 150ms ease-out, border-color 150ms ease-out, opacity 150ms ease-out",
      }}
    >{children}</div>
  );
}

function TitleCell({ title, sub, strike }: { title?: ReactNode; sub?: ReactNode; strike?: boolean }) {
  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ fontSize: 12, fontWeight: 500, color: text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", textDecoration: strike ? "line-through" : "none" }}>{title}</div>
      {sub ? <div style={{ fontSize: 10, color: "var(--color-text-faint)", marginTop: 1, display: "flex", alignItems: "center", gap: 3, minWidth: 0 }}>{sub}</div> : null}
    </div>
  );
}

export interface AlfredLeafRowProps {
  item: AlfredRow;
  onActivate?: () => void;
  todayYmd?: string;
  accent?: string;
  now?: Date;
  isNext?: boolean;
}

export function BillRow({ item, onActivate, todayYmd }: AlfredLeafRowProps) {
  const overdue = !item.paid && isOverdueYmd(item.next_date, todayYmd);
  return (
    <RowShell onActivate={onActivate} dim={item.paid}>
      <CreditCard size={13} color={dimmer} />
      <TitleCell title={item.name} sub={item.payee} />
      <span style={{ fontSize: 12, fontWeight: 600, color: text, fontVariantNumeric: "tabular-nums" }}>
        {formatAlfredMoney(item.amount)}
      </span>
      {item.paid ? (
        <span style={{
          display: "inline-flex", alignItems: "center", gap: 4, fontSize: 9.5, fontWeight: 600,
          padding: "2px 7px", borderRadius: 999, color: "var(--sp-green)",
          background: "color-mix(in srgb, var(--sp-green) 12%, transparent)", border: "1px solid color-mix(in srgb, var(--sp-green) 25%, transparent)",
          fontVariantNumeric: "tabular-nums",
        }}><Check size={9} strokeWidth={3} />Paid · {formatAlfredDate(item.next_date)}</span>
      ) : (
        <span style={{ fontSize: 10, color: overdue ? overdueColor : "var(--color-text-faint)", fontWeight: overdue ? 600 : 400, fontVariantNumeric: "tabular-nums" }}>
          {formatAlfredDate(item.next_date)}
        </span>
      )}
    </RowShell>
  );
}

export function EventRow({ item, accent, onActivate, now = new Date(), isNext }: AlfredLeafRowProps) {
  const passed = eventPassed(item, now);
  const location = item.location || "";
  // Day context now lives in the section header, so the sub line carries the
  // where instead — physical location, or a video-call hint.
  const sub = location
    ? <><MapPin size={9} style={{ flexShrink: 0 }} /><span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{location}</span></>
    : item.hangoutLink
      ? <><Video size={9} style={{ flexShrink: 0 }} />Video call</>
      : null;
  return (
    <RowShell onActivate={onActivate} dim={passed}>
      <span style={{
        width: 6, height: 6, borderRadius: 999, flexShrink: 0,
        // Per-calendar color (item.color) restores the color coding; the next
        // event's purple highlight still wins so it stays the standout.
        background: isNext ? "var(--sp-mauve)" : (item.color || accent),
        boxShadow: isNext ? "0 0 6px color-mix(in srgb, var(--sp-mauve) 60%, transparent)" : "none",
      }} />
      <span style={{
        fontSize: 10.5, color: isNext ? text : "var(--color-text-faint)", fontVariantNumeric: "tabular-nums",
        fontFamily: "var(--font-mono, 'Fira Code', ui-monospace, monospace)",
        width: 56, flexShrink: 0,
      }}>{item.allDay ? "all day" : item.time}</span>
      <TitleCell title={item.title} sub={sub} />
      <span style={{ fontSize: 10, color: "var(--color-text-faint)" }}>{item.calendarName}</span>
    </RowShell>
  );
}

export function DeadlineRow({ item, onActivate, todayYmd }: AlfredLeafRowProps) {
  // The cached row carries `status`, not `completed` — deadlineDone reads both.
  const done = deadlineDone(item);
  const StatusIcon = done ? CheckCircle2 : Circle;
  const priority = alfredPriorityLabel(item.priority);
  const overdue = !done && isOverdueYmd(item.due_date, todayYmd);
  return (
    <RowShell onActivate={onActivate} dim={done}>
      <StatusIcon size={13} color={done ? "var(--sp-green)" : dimmer} />
      <TitleCell title={item.content ?? item.title ?? ""} sub={null} strike={done} />
      {priority ? (
        <span style={{ fontSize: 9.5, fontWeight: 700, color: priority === "P1" ? "var(--sp-rose)" : priority === "P2" ? "var(--sp-peach)" : "var(--sp-blue)" }}>
          {priority}
        </span>
      ) : null}
      <span style={{ fontSize: 10, color: overdue ? overdueColor : "var(--color-text-faint)", fontWeight: overdue ? 600 : 400, fontVariantNumeric: "tabular-nums" }}>
        {formatAlfredDate(item.due_date)}
      </span>
    </RowShell>
  );
}

export function EmailRow({ item, onActivate }: AlfredLeafRowProps) {
  // Dot encodes two signals: attention lane → color, unread → fill vs ring.
  const { unread, attention } = emailDotState(item);
  const dotColor = attention ? "var(--sp-rose)" : "var(--sp-teal)";
  const sender = typeof item.from === "object" ? item.from : null;
  const fromName = sender?.name || sender?.address || (typeof item.from === "string" ? item.from : "");
  const absolute = item.email_date ? formatAlfredAbsolute(item.email_date) : "";
  return (
    <RowShell onActivate={onActivate} title={absolute ? `Received ${absolute}` : undefined}>
      <span style={{
        width: 6, height: 6, borderRadius: 999, flexShrink: 0, boxSizing: "border-box",
        background: unread ? dotColor : "transparent",
        border: unread ? "none" : `1.5px solid ${dotColor}`,
        boxShadow: attention && unread ? "0 0 6px color-mix(in srgb, var(--sp-rose) 60%, transparent)" : "none",
      }} />
      <TitleCell
        title={item.subject}
        sub={`${fromName} · ${formatAlfredAgo(item.email_date)}`}
      />
    </RowShell>
  );
}

export function TransactionRow({ item }: AlfredLeafRowProps) {
  return (
    <RowShell>
      <Receipt size={13} color={dimmer} />
      <TitleCell title={item.payee} sub={item.category} />
      <span style={{ fontSize: 12, fontWeight: 600, color: text, fontVariantNumeric: "tabular-nums" }}>
        {formatAlfredMoney(item.amount)}
      </span>
      <span style={{ fontSize: 10, color: "var(--color-text-faint)", fontVariantNumeric: "tabular-nums" }}>
        {formatAlfredDate(item.date)}
      </span>
    </RowShell>
  );
}

const SECTION_TONES: Record<string, { Icon: ComponentType<{ size?: number; color?: string }>; color: string }> = {
  attention: { Icon: Flag, color: "var(--sp-rose)" },
  done: { Icon: CheckCircle2, color: "var(--color-text-faint)" },
  paid: { Icon: Check, color: "var(--color-text-faint)" },
};

function SectionHeader({ label, tone }: { label: string; tone: string }) {
  const { Icon, color } = SECTION_TONES[tone] || { Icon: Clock, color: "var(--color-text-faint)" };
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 6, marginTop: 4, padding: "0 2px",
      fontSize: 10, fontWeight: 600, letterSpacing: 0.2, color,
    }}>
      <Icon size={11} color={color} />
      <span>{label}</span>
    </div>
  );
}

// React.memo so a completed rows-block goes inert during subsequent token
// streaming (perf audit fe-alfred::rows-chip-action-rebuilt-every-render). The
// churning prop was onActivateItem (now useCallback'd in AlfredPanel) and the
// per-render chip-action resolution + fresh per-row closures (now useMemo'd by
// items). Items are verbatim and referentially stable once a rows event lands.
export interface RowsBlockProps {
  kind: AlfredItemKind;
  items: AlfredRow[];
  accent: string;
  onActivateItem?: (action: AlfredChipAction) => void;
  now?: Date;
}

function UnknownRow(): null {
  return null;
}

export const RowsBlock = memo(function RowsBlock({ kind, items, accent, onActivateItem, now }: RowsBlockProps) {
  // Kept in sync with ROW_COMPONENTS in AlfredBreakdown.tsx (a non-component
  // const export here would trip react-refresh/only-export-components). Drift is
  // caught by AlfredBreakdown's per-kind render test.
  const Row = ({
    bill: BillRow, event: EventRow, deadline: DeadlineRow, email: EmailRow, transaction: TransactionRow,
  } as Partial<Record<AlfredItemKind, ComponentType<AlfredLeafRowProps>>>)[kind] ?? UnknownRow;
  // One `now` per block mount: a surfaced block is historical, so its time buckets
  // shouldn't drift as the session ticks on (tests inject a fixed `now`).
  const stableNow = useMemo(() => now ?? new Date(), [now]);
  // Order/section for display (email only; other kinds pass through unchanged),
  // then resolve chip actions and click closures once per items change. onActivate
  // stays undefined when no action resolves, preserving the interactivity gate.
  // With a stable onActivateItem these closures keep identity across renders.
  const groups = useMemo(() => {
    // Display-time context derived once per block: today's Pacific date drives
    // overdue coloring; the next upcoming event id drives the "next" emphasis.
    const todayYmd = pacificYMD(stableNow.getTime());
    const nextId = kind === "event" ? nextEventId(items, stableNow) : null;
    return groupAlfredRows(kind, items, stableNow).map((group, gi) => ({
      section: group.section,
      rows: group.items.map((item, i) => {
        const action = onActivateItem ? resolveAlfredChipAction(kind, item) : null;
        return {
          key: String(item.id ?? item.uid ?? `${gi}:${i}`),
          item,
          onActivate: action ? () => onActivateItem!(action) : undefined,
          extra: { now: stableNow, todayYmd, isNext: kind === "event" && item.id != null && item.id === nextId },
        };
      }),
    }));
  }, [kind, items, onActivateItem, stableNow]);
  const totalDue = kind === "bill" ? billsTotalDue(items) : 0;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
      {groups.map((group, gi) => (
        <Fragment key={group.section?.label ?? `g${gi}`}>
          {group.section ? <SectionHeader label={group.section.label} tone={group.section.tone} /> : null}
          {group.rows.map(({ key, item, onActivate, extra }) => (
            <Row key={key} item={item} accent={accent} onActivate={onActivate} {...extra} />
          ))}
        </Fragment>
      ))}
      {kind === "bill" && totalDue > 0 ? (
        <div style={{
          display: "flex", justifyContent: "space-between", alignItems: "center",
          marginTop: 3, padding: "5px 10px",
          borderTop: "1px solid rgba(255,255,255,0.06)",
          fontSize: 11, color: "var(--color-text-faint)",
        }}>
          <span>Total due</span>
          <span style={{ fontWeight: 600, color: text, fontVariantNumeric: "tabular-nums" }}>
            {formatAlfredMoney(totalDue)}
          </span>
        </div>
      ) : null}
    </div>
  );
});
