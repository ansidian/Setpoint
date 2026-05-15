import { forwardRef, useMemo, useState } from "react";
import { parseYmd, ymdFromParts } from "../../calendarDateUtils.js";
import AgendaRailShell from "../agenda/AgendaRailShell.jsx";
import MiniCalendar, { AgendaRailWithMiniCalendar } from "../agenda/MiniCalendar.jsx";
import {
  buildBillsAgendaGroups,
  buildBillsMiniCalendarActivityItems,
} from "./billsAgendaModel.js";

function groupDate(group) {
  const parsed = parseYmd(group.dateKey);
  return parsed ? new Date(parsed.year, parsed.month, parsed.day) : null;
}

function AgendaHeader({ group, todayKey, onActivate, registerHeader }) {
  const date = groupDate(group);
  return (
    <button
      type="button"
      ref={(node) => registerHeader(group.dateKey, node)}
      data-agenda-date-header="true"
      data-date-key={group.dateKey}
      aria-label={`Select ${date ? date.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" }) : group.dateKey}`}
      onClick={() => onActivate(group.dateKey)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onActivate(group.dateKey);
        }
      }}
      style={{
        position: "sticky",
        top: 0,
        zIndex: 4,
        width: "calc(100% + 20px)",
        margin: "0 -10px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 8,
        minHeight: 34,
        padding: "8px 10px 7px",
        border: "0",
        borderRadius: 0,
        background: "#1f1f24",
        color: group.dateKey === todayKey ? "#0495FF" : "#B1B1B3",
        fontSize: 12,
        fontWeight: 800,
        letterSpacing: 1.35,
        lineHeight: 1,
        textAlign: "left",
        textTransform: "uppercase",
        cursor: "pointer",
        transition: "background-color 180ms cubic-bezier(0.16, 1, 0.3, 1), color 180ms cubic-bezier(0.16, 1, 0.3, 1)",
      }}
      onMouseEnter={(event) => {
        event.currentTarget.style.background = "#23232a";
      }}
      onMouseLeave={(event) => {
        event.currentTarget.style.background = "#1f1f24";
      }}
    >
      <span>{group.headerLabel}</span>
    </button>
  );
}

function BillRow({ bill, selected, onSelect, onPreviewStart, onPreviewEnd }) {
  const color = bill.agendaSelectedColor;
  return (
    <button
      type="button"
      data-testid="calendar-agenda-bill-row"
      data-item-id={bill.agendaItemId}
      data-calendar-match-item-ids={[bill.id, bill.scheduleId].filter(Boolean).join(" ")}
      onClick={(event) => onSelect(bill, event.currentTarget)}
      style={{
        width: "100%",
        display: "grid",
        gridTemplateColumns: "8px minmax(0, 1fr) auto",
        alignItems: "start",
        columnGap: 8,
        rowGap: 4,
        padding: "8px 9px",
        borderRadius: 8,
        border: selected ? `1px solid color-mix(in srgb, ${color} 72%, rgba(255,255,255,0.08))` : "1px solid rgba(255,255,255,0.055)",
        background: selected ? `color-mix(in srgb, ${color} 18%, transparent)` : "rgba(255,255,255,0.025)",
        color: bill.agendaComplete ? "rgba(205,214,244,0.58)" : "#cdd6f4",
        cursor: "pointer",
        textAlign: "left",
        transition: "transform 170ms cubic-bezier(0.16, 1, 0.3, 1), background-color 170ms cubic-bezier(0.16, 1, 0.3, 1), border-color 170ms cubic-bezier(0.16, 1, 0.3, 1)",
      }}
      onMouseEnter={(event) => {
        event.currentTarget.style.transform = "translateY(-1px)";
        if (!selected) event.currentTarget.style.borderColor = "rgba(255,255,255,0.12)";
        onPreviewStart?.(bill);
      }}
      onMouseLeave={(event) => {
        event.currentTarget.style.transform = "translateY(0)";
        if (!selected) event.currentTarget.style.borderColor = "rgba(255,255,255,0.055)";
        onPreviewEnd?.(bill);
      }}
      onFocus={(event) => {
        event.currentTarget.style.transform = "translateY(-1px)";
        if (!selected) event.currentTarget.style.borderColor = "rgba(255,255,255,0.12)";
        onPreviewStart?.(bill);
      }}
      onBlur={(event) => {
        event.currentTarget.style.transform = "translateY(0)";
        if (!selected) event.currentTarget.style.borderColor = "rgba(255,255,255,0.055)";
        onPreviewEnd?.(bill);
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: 7,
          height: 7,
          marginTop: 5,
          gridColumn: 1,
          gridRow: "1 / span 3",
          borderRadius: 999,
          background: bill.agendaDotColor,
          boxShadow: selected ? `0 0 0 3px color-mix(in srgb, ${color} 16%, transparent)` : "none",
        }}
      />
      <span
        style={{
          minWidth: 0,
          gridColumn: 2,
          display: "flex",
          flexDirection: "column",
          gap: 4,
        }}
      >
        <span style={{ color: bill.agendaComplete ? "rgba(166,173,200,0.54)" : "rgba(166,173,200,0.82)", fontSize: 10, fontWeight: 700, lineHeight: 1.2 }}>
          {bill.agendaMeta}
        </span>
        <span style={{ color: bill.agendaComplete ? "rgba(205,214,244,0.62)" : "#f1f2fb", fontSize: 12, fontWeight: 650, lineHeight: 1.25, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textDecoration: bill.agendaComplete ? "line-through" : "none", textDecorationColor: "rgba(205,214,244,0.28)" }}>
          {bill.agendaTitle}
        </span>
        {bill.agendaSubtitle ? (
          <span style={{ color: "rgba(166,173,200,0.64)", fontSize: 10.5, lineHeight: 1.3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {bill.agendaSubtitle}
          </span>
        ) : null}
      </span>
      <span style={{ gridColumn: 3, gridRow: "1 / span 3", display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6, minWidth: 68 }}>
        <span style={{ color: bill.agendaComplete ? "rgba(166,227,161,0.72)" : color, fontSize: 12, fontWeight: 750, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
          {bill.agendaAmount}
        </span>
        <span style={{ color: "rgba(166,173,200,0.62)", fontSize: 9.5, fontWeight: 700, lineHeight: 1.1, textTransform: "uppercase", whiteSpace: "nowrap" }}>
          {bill.agendaStatus}
        </span>
      </span>
    </button>
  );
}

function EmptyBillDay({ fallback }) {
  return (
    <div
      style={{
        padding: "12px 10px",
        borderRadius: 8,
        border: "1px solid rgba(255,255,255,0.055)",
        background: "rgba(255,255,255,0.025)",
        color: "rgba(205,214,244,0.64)",
        fontSize: 12,
        lineHeight: 1.4,
      }}
    >
      <div style={{ fontWeight: 650, color: "rgba(205,214,244,0.82)" }}>
        {fallback ? "No Bills This Month" : "No Bills"}
      </div>
    </div>
  );
}

function previewSourceKey(item) {
  return `${item?.agendaItemId || item?.id || ""}:${item?.agendaDateKey || item?.dateKey || ""}`;
}

function previewItemForBill(item) {
  const dateKey = item?.agendaDateKey || item?.dateKey || null;
  return {
    ...item,
    kind: "bill",
    dateKey,
    agendaDateKey: dateKey,
    markerColor: item?.agendaDotColor || item?.agendaSelectedColor,
    previewSourceKey: previewSourceKey(item),
  };
}

const BillsAgendaRail = forwardRef(function BillsAgendaRail({
  viewYear,
  viewMonth,
  computed,
  selectedDateKey,
  selectedItemId,
  scrollCommand = null,
  entryScrollTargetDateKey = null,
  currentYear,
  currentMonth,
  todayDate,
  canGoPrev = true,
  onPreviousMonth,
  onNextMonth,
  onPassiveDateChange,
  onDateAction,
  onMiniCalendarDateAction,
  onMiniCalendarDateCreate,
  onBillAction,
}, ref) {
  const todayKey = ymdFromParts(currentYear, currentMonth, todayDate);
  const agenda = useMemo(() => buildBillsAgendaGroups({
    computed,
    viewYear,
    viewMonth,
    todayKey,
    forceVisibleDateKey: entryScrollTargetDateKey || selectedDateKey,
  }), [computed, entryScrollTargetDateKey, selectedDateKey, todayKey, viewMonth, viewYear]);
  const miniCalendarItems = useMemo(() => buildBillsMiniCalendarActivityItems({
    computed,
    viewYear,
    viewMonth,
  }), [computed, viewMonth, viewYear]);
  const [hoverPreviewItem, setHoverPreviewItem] = useState(null);

  function startHoverPreview(item) {
    setHoverPreviewItem(previewItemForBill(item));
  }

  function endHoverPreview(item) {
    const sourceKey = previewSourceKey(item);
    setHoverPreviewItem((current) => (
      current?.previewSourceKey === sourceKey ? null : current
    ));
  }

  return (
    <AgendaRailWithMiniCalendar
      miniCalendar={(
        <MiniCalendar
          viewYear={viewYear}
          viewMonth={viewMonth}
          todayKey={todayKey}
          selectedDateKey={selectedDateKey}
          activityItems={miniCalendarItems}
          hoverPreviewItem={hoverPreviewItem}
          canGoPrev={canGoPrev}
          onPreviousMonth={onPreviousMonth}
          onNextMonth={onNextMonth}
          onDateAction={onMiniCalendarDateAction}
          onDateCreate={onMiniCalendarDateCreate}
        />
      )}
    >
      <AgendaRailShell
        ref={ref}
        testId="bills-agenda-rail"
        groups={agenda.visibleGroups}
        firstVisibleDateKey={agenda.firstVisibleDateKey}
        todayKey={todayKey}
        selectedDateKey={selectedDateKey}
        scrollCommand={scrollCommand}
        entryScrollTargetDateKey={entryScrollTargetDateKey}
        onPassiveDateChange={onPassiveDateChange}
        renderHeader={({ group, registerHeader }) => (
          <AgendaHeader
            group={group}
            todayKey={todayKey}
            registerHeader={registerHeader}
            onActivate={onDateAction}
          />
        )}
        renderGroup={({ group, registerRow, registerContent }) => (
          <>
            {group.items.map((bill) => (
              <span
                key={bill.agendaKey}
                ref={(node) => registerRow(bill.agendaKey, node, group.dateKey)}
              >
                <BillRow
                  bill={bill}
                  selected={String(selectedItemId || "") === bill.agendaItemId}
                  onPreviewStart={startHoverPreview}
                  onPreviewEnd={endHoverPreview}
                  onSelect={(item, element) => onBillAction?.({
                    item,
                    dateKey: item.agendaDateKey,
                    anchorElement: element,
                    sourceCellElement: element,
                    anchorKind: "agenda-row",
                  })}
                />
              </span>
            ))}
            {!group.hasBills && (group.isFallback || selectedDateKey === group.dateKey || todayKey === group.dateKey) ? (
              <div ref={(node) => registerContent(group.dateKey, node)}>
                <EmptyBillDay fallback={group.isFallback} />
              </div>
            ) : null}
          </>
        )}
      />
    </AgendaRailWithMiniCalendar>
  );
});

export default BillsAgendaRail;
