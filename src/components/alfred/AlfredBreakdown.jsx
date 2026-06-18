// Auto-rendered grouped-count card for the group_items tool result. Counts +
// proportional bars with adaptive, cite-by-reference drill-down: each bucket
// expands to the verbatim domain rows behind it (ADR 0006: read-only, never
// reshape values). Buckets arrive pre-ordered (count desc, "Other" last).
import { memo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { countBreakdownRows } from "./alfredPanelModel.js";
import { BillRow, DeadlineRow, EmailRow, EventRow, TransactionRow } from "./AlfredRows.jsx";
import { resolveAlfredChipAction } from "./alfredChipActionModel.js";
import { pacificYMD } from "../calendar/calendarDateUtils.js";

const text = "#cdd6f4";
const subtle = "var(--color-text-faint)";
const INLINE_THRESHOLD = 5;

// Local kind→row map. The leaf rows are shared from AlfredRows (which keeps its
// own inline map); duplicating this 5-key literal avoids a non-component export
// from AlfredRows that would break Fast Refresh (react-refresh/only-export-components).
const ROW_COMPONENTS = {
  bill: BillRow, event: EventRow, deadline: DeadlineRow, email: EmailRow, transaction: TransactionRow,
};

function Bucket({ row, items, kind, accent, onActivateItem, todayYmd, now }) {
  const [open, setOpen] = useState(row.count <= INLINE_THRESHOLD);
  const Row = ROW_COMPONENTS[kind];
  const Chevron = open ? ChevronDown : ChevronRight;
  const toggle = () => setOpen((v) => !v);
  return (
    <div>
      <div
        role="button"
        tabIndex={0}
        onClick={toggle}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); } }}
        style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 5, cursor: "pointer" }}
      >
        <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, color: row.isOther ? subtle : text }}>
          <Chevron size={13} color={subtle} />{row.label}
        </span>
        <span style={{ fontSize: 12.5, fontWeight: 600, color: row.isOther ? subtle : text, fontVariantNumeric: "tabular-nums" }}>
          {row.count}
        </span>
      </div>
      <div style={{ height: 4, borderRadius: 2, background: "rgba(255,255,255,0.05)" }}>
        <div
          className="alfred-bar-grow"
          style={{ width: `${row.pct}%`, height: "100%", borderRadius: 2, transformOrigin: "left", background: row.isOther ? "rgba(108,112,134,0.7)" : accent, opacity: 0.85 }}
        />
      </div>
      {open && Row ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 5, margin: "9px 0 2px 19px" }}>
          {items.map((item, i) => {
            const action = onActivateItem ? resolveAlfredChipAction(kind, item) : null;
            // Superset of props: each leaf row reads only what it needs (EmailRow
            // ignores now/todayYmd/isNext; bill/deadline use todayYmd; event uses
            // now). Harmless extras keep one render path across kinds.
            return (
              <Row
                key={item.id ?? item.uid ?? i}
                item={item}
                accent={accent}
                onActivate={action ? () => onActivateItem(action) : undefined}
                now={now}
                todayYmd={todayYmd}
                isNext={false}
              />
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function AlfredBreakdown({ kind, title, caption, total, buckets, accent, onActivateItem }) {
  const rows = countBreakdownRows(buckets);
  if (!rows.length) return null;
  const now = new Date();
  const todayYmd = pacificYMD(now.getTime());
  return (
    <div style={{ background: "rgba(36,36,58,0.45)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 12, padding: "13px 13px 10px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 13 }}>
        <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: 1.2, color: subtle }}>{title}</span>
        <span style={{ fontSize: 11, color: subtle }}>{caption ? `${caption} · ` : ""}{total} total</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {rows.map((row, i) => (
          <Bucket
            // Index tiebreaks the label: the model may emit two buckets with the
            // same label, and a bare label key would collide and share open-state.
            key={`${row.label}-${i}`}
            row={row}
            items={buckets[i].items || []}
            kind={kind}
            accent={accent}
            onActivateItem={onActivateItem}
            todayYmd={todayYmd}
            now={now}
          />
        ))}
      </div>
    </div>
  );
}

export default memo(AlfredBreakdown);
