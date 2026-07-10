import { forwardRef, useCallback, useDeferredValue, useMemo, useRef, useState } from "react";
import { Receipt } from "lucide-react";
import { parseYmd, ymdFromParts } from "../../calendarDateUtils.js";
import AgendaMonthScrollContainer from "../agenda/AgendaMonthScrollContainer.jsx";
import AgendaRailShell from "../agenda/AgendaRailShell.jsx";
import MiniCalendar, { AgendaRailWithMiniCalendar } from "../agenda/MiniCalendar.jsx";
import {
  buildBillsAgendaGroups,
  buildBillsMiniCalendarActivityItems,
  reuseMultiMonthBillsAgendaGroups,
} from "./billsAgendaModel.js";
import { useAgendaFetch } from "../../../../hooks/calendar/useAgendaFetch.js";
import { scrollCommandTargetMonth } from "../../../../hooks/calendar/agendaFetchModel.js";

function parseMonthKey(mk) {
  return { year: Number(mk.slice(0, 4)), month: Number(mk.slice(5, 7)) - 1 };
}

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
        background: "var(--sp-panel)",
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
        event.currentTarget.style.background = "var(--sp-panel)";
      }}
      onMouseLeave={(event) => {
        event.currentTarget.style.background = "var(--sp-panel)";
      }}
    >
      <span>{group.headerLabel}</span>
    </button>
  );
}

function BillRow({ bill, selected, onSelect, onPreviewStart, onPreviewEnd }) {
  const color = bill.agendaSelectedColor;
  const itemKind = bill.agendaItemKind === "transaction" ? "transaction" : "bill";
  return (
    <button
      type="button"
      className="sp-agenda-touch"
      data-testid={`calendar-agenda-${itemKind}-row`}
      data-item-kind={itemKind}
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
        color: bill.agendaComplete ? "rgba(205,214,244,0.58)" : "var(--sp-text)",
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
        <span style={{ color: bill.agendaComplete ? "rgba(166,173,200,0.75)" : "rgba(166,173,200,0.82)", fontSize: 10, fontWeight: 700, lineHeight: 1.2 }}>
          {bill.agendaMeta}
        </span>
        <span style={{ color: bill.agendaComplete ? "rgba(205,214,244,0.62)" : "#f1f2fb", fontSize: 12, fontWeight: 650, lineHeight: 1.25, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textDecoration: bill.agendaComplete ? "line-through" : "none", textDecorationColor: "rgba(205,214,244,0.28)" }}>
          {bill.agendaTitle}
        </span>
        {bill.agendaSubtitle ? (
          <span style={{ color: "rgba(166,173,200,0.75)", fontSize: 10.5, lineHeight: 1.3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {bill.agendaSubtitle}
          </span>
        ) : null}
      </span>
      <span style={{ gridColumn: 3, gridRow: "1 / span 3", display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6, minWidth: 68 }}>
        <span style={{ color: bill.agendaComplete ? "color-mix(in srgb, var(--sp-green) 72%, transparent)" : color, fontSize: 12, fontWeight: 750, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
          {bill.agendaAmount}
        </span>
        <span style={{ color: "rgba(166,173,200,0.75)", fontSize: 9.5, fontWeight: 700, lineHeight: 1.1, textTransform: "uppercase", whiteSpace: "nowrap" }}>
          {bill.agendaStatus}
        </span>
      </span>
    </button>
  );
}

function EmptyBillDay({ fallback, mobileAgenda, monthName }) {
  const enriched = mobileAgenda && fallback;
  return (
    <div
      style={{
        padding: enriched ? "28px 16px" : "12px 10px",
        borderRadius: 8,
        border: "1px solid rgba(255,255,255,0.055)",
        background: "rgba(255,255,255,0.025)",
        color: "rgba(205,214,244,0.64)",
        fontSize: 12,
        lineHeight: 1.4,
        ...(enriched ? {
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          textAlign: "center",
          gap: 8,
        } : null),
      }}
    >
      {enriched ? (
        <>
          <Receipt size={28} aria-hidden="true" style={{ color: "var(--color-text-faint)" }} />
          <div style={{ fontWeight: 650, color: "rgba(205,214,244,0.82)" }}>No bills due in {monthName}</div>
          <div style={{ color: "var(--color-text-faint)" }}>Days you add will appear here.</div>
        </>
      ) : (
        <div style={{ fontWeight: 650, color: "rgba(205,214,244,0.82)" }}>
          {fallback ? "No Bills This Month" : "No Bills"}
        </div>
      )}
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
    kind: item?.agendaItemKind === "transaction" ? "transaction" : "bill",
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
  hideMiniCalendar = false,
  onBillAction,
  getMonthBills = null,
  billsRange = null,
  dataRevision = 0,
  mobileAgenda = false,
}, ref) {
  const todayKey = ymdFromParts(currentYear, currentMonth, todayDate);
  const forceVisibleDateKey = entryScrollTargetDateKey || selectedDateKey;

  // Infinite-scroll multi-month pipeline (mirrors EventsAgendaRail). Gated purely
  // on data-provider presence — no isMobile branch — so it lands on desktop and
  // mobile alike, and degrades to the single-month build when no range is wired
  // (which keeps the single-month unit tests, that pass no range, green).
  const multiMonthEnabled = !!getMonthBills && typeof billsRange?.ensureRange === "function";
  const pendingTargetMonth = scrollCommandTargetMonth(scrollCommand, todayKey);
  const [topmostMonth, setTopmostMonth] = useState(null);

  // initialReady is intentionally unused: bills keeps the single-month build as
  // the fallback while the first window loads (no skeleton), so the rail never
  // goes blank and needs no readiness gate.
  const { loadedMonths } = useAgendaFetch({
    topmostMonth,
    pendingTargetMonth,
    domainRange: billsRange,
    deadlinesRange: null,
    todayKey,
    disabled: !multiMonthEnabled,
  });

  const monthDescriptors = useMemo(() => {
    if (!multiMonthEnabled || !loadedMonths.length) return null;
    return loadedMonths.map(parseMonthKey);
  }, [multiMonthEnabled, loadedMonths]);

  // Defer the (per-month rebuild) inputs so a prefetch landing mid-scroll keeps
  // scroll renders on the prior months and moves the rebuild off the urgent path.
  const deferredMonthDescriptors = useDeferredValue(monthDescriptors);
  const deferredDataRevision = useDeferredValue(dataRevision);

  const monthGroupsCacheRef = useRef(null);
  const multiMonthGroups = useMemo(() => {
    if (!multiMonthEnabled || !deferredMonthDescriptors) return null;
    const { list, cache } = reuseMultiMonthBillsAgendaGroups({
      previous: monthGroupsCacheRef.current,
      months: deferredMonthDescriptors,
      getMonthBills,
      todayKey,
      forceVisibleDateKey,
    });
    monthGroupsCacheRef.current = cache;
    return list;
    // deferredDataRevision invalidates the ref-backed getMonthBills reads
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [multiMonthEnabled, deferredMonthDescriptors, getMonthBills, todayKey, forceVisibleDateKey, deferredDataRevision]);

  // Single-month fallback: kept available whenever the multi-month list isn't
  // ready yet (gate off OR the first window still loading), so the rail always
  // renders the current month immediately — no skeleton flash, matching today's
  // bills behavior.
  const singleMonthAgenda = useMemo(() => {
    if (multiMonthGroups) return null;
    return buildBillsAgendaGroups({
      computed,
      viewYear,
      viewMonth,
      todayKey,
      forceVisibleDateKey,
    });
  }, [multiMonthGroups, computed, viewYear, viewMonth, todayKey, forceVisibleDateKey]);

  const miniCalendarItems = useMemo(() => buildBillsMiniCalendarActivityItems({
    computed,
    viewYear,
    viewMonth,
  }), [computed, viewMonth, viewYear]);
  const [hoverPreviewItem, setHoverPreviewItem] = useState(null);

  const months = useMemo(() => {
    if (multiMonthGroups) return multiMonthGroups;
    if (!singleMonthAgenda) return [];
    return [{
      monthKey: `${viewYear}-${String(viewMonth + 1).padStart(2, "0")}`,
      year: viewYear,
      month: viewMonth,
      ...singleMonthAgenda,
    }];
  }, [multiMonthGroups, singleMonthAgenda, viewYear, viewMonth]);

  function startHoverPreview(item) {
    setHoverPreviewItem(previewItemForBill(item));
  }

  function endHoverPreview(item) {
    const sourceKey = previewSourceKey(item);
    setHoverPreviewItem((current) => (
      current?.previewSourceKey === sourceKey ? null : current
    ));
  }

  // Track the topmost-visible month (drives useAgendaFetch's edge prefetch) and
  // still forward the passive date change for selection sync.
  const handleTopmostDateChange = useCallback((dateKey) => {
    if (dateKey) setTopmostMonth(dateKey.slice(0, 7));
    onPassiveDateChange?.(dateKey);
  }, [onPassiveDateChange]);

  const renderMonth = useCallback((month, { registerHeader, registerSection, registerRow, registerContent }) => (
    <AgendaRailShell
      groups={month.visibleGroups}
      registerHeader={registerHeader}
      registerSection={registerSection}
      registerRow={registerRow}
      registerContent={registerContent}
      renderHeader={({ group, registerHeader: regHeader }) => (
        <AgendaHeader
          group={group}
          todayKey={todayKey}
          registerHeader={regHeader}
          onActivate={onDateAction}
        />
      )}
      renderGroup={({ group, registerRow: regRow, registerContent: regContent }) => (
        <>
          {group.items.map((bill) => (
            <span
              key={bill.agendaKey}
              ref={(node) => regRow(bill.agendaKey, node, group.dateKey)}
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
                  detailKind: item.agendaItemKind === "transaction" ? "transaction" : null,
                })}
              />
            </span>
          ))}
          {!group.hasBills && (group.isFallback || selectedDateKey === group.dateKey || todayKey === group.dateKey) ? (
            <div ref={(node) => regContent(group.dateKey, node)}>
              <EmptyBillDay
                fallback={group.isFallback}
                mobileAgenda={mobileAgenda}
                monthName={groupDate(group)?.toLocaleDateString("en-US", { month: "long" })}
              />
            </div>
          ) : null}
        </>
      )}
    />
  ), [todayKey, selectedDateKey, selectedItemId, onDateAction, onBillAction, mobileAgenda]);

  return (
    <AgendaRailWithMiniCalendar
      miniCalendar={hideMiniCalendar ? null : (
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
      {/* entryScrollReady/skeleton are intentionally omitted (unlike EventsAgendaRail):
          bills never shows an agenda skeleton — the single-month build is the always-
          ready fallback while the first multi-month window loads. */}
      <AgendaMonthScrollContainer
        ref={ref}
        testId="bills-agenda-rail"
        months={months}
        todayKey={todayKey}
        selectedDateKey={selectedDateKey}
        scrollCommand={scrollCommand}
        entryScrollTargetDateKey={entryScrollTargetDateKey}
        isLoading={!!billsRange?.loading}
        onTopmostDateChange={handleTopmostDateChange}
        renderMonth={renderMonth}
      />
    </AgendaRailWithMiniCalendar>
  );
});

export default BillsAgendaRail;
