/* eslint-disable react-refresh/only-export-components */
import { Receipt, Zap } from "lucide-react";
import {
  EmptyDayCard,
  getOverviewModel,
  MetricCard,
  NearbyActivityCard,
  OverviewHero,
  SpotlightCard,
} from "../../CalendarRailStates.jsx";
import { RailFactTile, RailMetaChip } from "../../DetailRailPrimitives.jsx";
import { daysUntil, formatAmount, urgencyColor } from "../../../../lib/bill-utils";
import { TRACKED_UTILITIES } from "./billsModel.js";
import {
  compactPanelStyle,
  compactEyebrowStyle,
  compactValueStyle,
  compactDetailStyle,
  compactMetricRowStyle,
  nearestBusyDay,
} from "../compactBandPrimitives.jsx";
import BillSupportCard from "./BillSupportCard.jsx";

function bandGridStyle(layout, wide = false) {
  if (layout.tier === "md") {
    return {
      display: "grid",
      gridTemplateColumns: "minmax(0, 1fr)",
      gap: 8,
      minHeight: "100%",
    };
  }

  return {
    display: "grid",
    gridTemplateColumns: wide ? "minmax(0, 1fr)" : "minmax(0, 1.18fr) minmax(208px, 0.82fr) minmax(184px, 0.82fr)",
    gap: 8,
    minHeight: "100%",
  };
}

function panelStyle() {
  return {
    padding: "8px 10px",
    borderRadius: 14,
    border: "1px solid rgba(255,255,255,0.05)",
    background: "rgba(255,255,255,0.018)",
    minWidth: 0,
  };
}

function clampStyle(lines = 2) {
  return {
    display: "-webkit-box",
    WebkitLineClamp: lines,
    WebkitBoxOrient: "vertical",
    overflow: "hidden",
  };
}

function stackStyle() {
  return {
    display: "flex",
    flexDirection: "column",
    gap: 8,
    minHeight: 0,
  };
}

function summarizeUtilities(data) {
  const schedules = data?.schedules || [];
  const payeeMap = data?.payeeMap || {};
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });

  const rows = TRACKED_UTILITIES.map((utility) => {
    const schedule = schedules.find((entry) => {
      const payeeCond = entry.conditions?.find((condition) => condition.field === "payee");
      const payeeName = payeeCond ? payeeMap[payeeCond.value] : null;
      const haystack = `${payeeName || ""} ${entry.name || ""}`.toLowerCase();
      return haystack.includes(utility.match);
    });

    return {
      key: utility.key,
      found: !!schedule,
      stale: !schedule?.next_date || schedule.next_date < today,
    };
  });

  return {
    healthy: rows.filter((row) => row.found && !row.stale).length,
    stale: rows.filter((row) => row.found && row.stale).length,
    missing: rows.filter((row) => !row.found).length,
  };
}

function formatShortDate(year, month, day) {
  return new Date(year, month, day).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function OverviewSupport({ layout, model, computed, data, itemsByDay, viewYear, viewMonth }) {
  const compactBand = !layout.stacked;
  const utilities = summarizeUtilities(data);

  if (compactBand) {
    const nearestBusy = nearestBusyDay(itemsByDay, 1, viewYear, viewMonth);
    return (
      <div style={bandGridStyle(layout)}>
        <div style={compactPanelStyle(model.accent, true)}>
          <div style={compactEyebrowStyle()}>{model.eyebrow}</div>
          <div style={compactValueStyle("#f5f7ff", 18)}>{model.title}</div>
          <div style={compactDetailStyle()}>
            {nearestBusy ? `${nearestBusy.count} bill${nearestBusy.count === 1 ? "" : "s"} next on ${nearestBusy.label}.` : "Month is clear"}
          </div>
        </div>
        <div style={compactPanelStyle(model.accent)}>
          <div style={compactEyebrowStyle()}>{data?.isLoading ? "Loading month" : model.spotlight.label}</div>
          <div style={compactValueStyle("#fff", 18)}>
            {data?.isLoading ? "Pulling bills" : model.spotlight.value}
          </div>
          <div style={compactDetailStyle()}>
            {data?.isLoading ? "Month context stays visible while bills load." : model.spotlight.detail}
          </div>
        </div>
        <div style={compactPanelStyle()}>
          <div style={compactEyebrowStyle()}>At a glance</div>
          {model.stats.map((stat) => (
            <div key={stat.label} style={compactMetricRowStyle()}>
              <span style={{ minWidth: 0, fontSize: 11, lineHeight: 1.35, color: "rgba(205,214,244,0.62)" }}>{stat.label}</span>
              <span style={{ fontSize: 16, lineHeight: 1, color: model.accent, fontWeight: 500, fontVariantNumeric: "tabular-nums" }}>{stat.value}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div style={bandGridStyle(layout)}>
      <div style={stackStyle()}>
        <OverviewHero model={model} compact={compactBand} />
        <div style={{ ...panelStyle(), display: "flex", alignItems: "center", gap: 10 }}>
          <Zap size={16} color="#a6e3a1" />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 2, textTransform: "uppercase", color: "rgba(205,214,244,0.44)" }}>
              Utility health
            </div>
            <div style={{ ...clampStyle(2), marginTop: 4, fontSize: 11, lineHeight: 1.45, color: "rgba(205,214,244,0.58)" }}>
              {utilities.healthy} current, {utilities.stale} stale, {utilities.missing} missing tracked utilities.
            </div>
          </div>
        </div>
      </div>

      <div style={stackStyle()}>
        <SpotlightCard
          accent={model.accent}
          label={model.spotlight.label}
          value={model.spotlight.value}
          detail={model.spotlight.detail}
          compact={compactBand}
        />
        <MetricCard
          label="Average due"
          value={formatAmount((computed?.monthTotal || 0) / Math.max(model.stats[0]?.value ? Number(model.stats[0].value) || 1 : 1, 1))}
          detail="Mean scheduled amount across unpaid volume"
          accent={model.accent}
          compact={compactBand}
        />
      </div>

      <div style={{ display: "grid", gridTemplateRows: "repeat(3, minmax(0, 1fr))", gap: compactBand ? 8 : 12 }}>
        {model.stats.map((stat) => (
          <MetricCard key={stat.label} {...stat} accent={model.accent} compact={compactBand} />
        ))}
        <MetricCard
          label="Utility health"
          value={`${utilities.healthy}/${TRACKED_UTILITIES.length}`}
          detail={utilities.stale ? `${utilities.stale} statement${utilities.stale === 1 ? "" : "s"} need attention` : "Tracked utilities look current"}
          accent={model.accent}
          compact={compactBand}
        />
      </div>
    </div>
  );
}

function EmptySupport({ layout, model, itemsByDay, selectedDay, viewYear, viewMonth, activeView, onSelectDay }) {
  const compactBand = !layout.stacked;

  if (compactBand) {
    const nearestBusy = nearestBusyDay(itemsByDay, selectedDay, viewYear, viewMonth);
    return (
      <div style={bandGridStyle(layout)}>
        <div data-testid="calendar-selected-empty-rail" style={compactPanelStyle(model.accent, true)}>
          <div style={compactEyebrowStyle()}>{model.selectedDayLabel}</div>
          <div style={compactValueStyle("#fff", 18)}>
            {new Date(viewYear, viewMonth, selectedDay).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
          </div>
          <div style={compactDetailStyle()}>{model.railDescription}</div>
        </div>
        <div style={compactPanelStyle()}>
          <div style={compactEyebrowStyle()}>{nearestBusy ? "Nearest activity" : "Month is clear"}</div>
          <div style={compactValueStyle("#fff", 18)}>
            {nearestBusy ? nearestBusy.label : "No nearby bills"}
          </div>
          <div style={compactDetailStyle()}>
            {nearestBusy
              ? `${nearestBusy.count} bill${nearestBusy.count === 1 ? "" : "s"} sitting ${nearestBusy.direction} on the grid.`
              : "Use arrows or click another day to review billing rhythm."}
          </div>
        </div>
        <div style={compactPanelStyle()}>
          <div style={compactEyebrowStyle()}>Action model</div>
          <div style={compactValueStyle("#a6e3a1", 18)}>Review only</div>
          <div style={compactDetailStyle()}>Open Actual from selected bill details when a schedule exists.</div>
        </div>
      </div>
    );
  }

  return (
    <div style={bandGridStyle(layout, true)}>
      <div style={{ display: "grid", gridTemplateColumns: layout.tier === "md" ? "minmax(0, 1fr)" : "minmax(280px, 1.02fr) minmax(0, 0.98fr)", gap: compactBand ? 8 : 12 }}>
        <EmptyDayCard model={model} viewYear={viewYear} viewMonth={viewMonth} selectedDay={selectedDay} compact={compactBand} />
        <div style={stackStyle()}>
          <NearbyActivityCard
            model={model}
            activeView={activeView}
            itemsByDay={itemsByDay}
            selectedDay={selectedDay}
            viewYear={viewYear}
            viewMonth={viewMonth}
            onSelectDay={onSelectDay}
            compact={compactBand}
          />
          {!compactBand ? (
            <div style={{ ...panelStyle(), fontSize: 11.5, lineHeight: 1.5, color: "rgba(205,214,244,0.58)" }}>
            Empty billing days are useful spacing. The right stage stays focused on navigation while this band shows the day-level context.
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function DetailSupport({ layout, selectedBill, selectedDayState, selectedDay, viewYear, viewMonth }) {
  const compactBand = !layout.stacked;

  if (compactBand) {
    const days = daysUntil(selectedBill?.next_date);
    const urgency = urgencyColor(days);
    const statusLabel = selectedBill?.paid ? "Paid" : days === 0 ? "Due today" : days < 0 ? "Overdue" : `In ${days}d`;
    return (
      <div style={bandGridStyle(layout)}>
        <div data-testid="calendar-selected-bill-card" style={compactPanelStyle("#a6e3a1", true)}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
            <div style={compactEyebrowStyle()}>Selected bill</div>
            <RailMetaChip tone="accent" color={selectedBill?.paid ? "#a6e3a1" : urgency.accent} compact>{statusLabel}</RailMetaChip>
          </div>
          <div style={{ ...compactValueStyle("#fff", 18), overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {selectedBill?.name || "Unnamed bill"}
          </div>
          <div style={compactDetailStyle()}>{formatAmount(selectedBill?.amount || 0)} · {statusLabel}</div>
        </div>
        <div style={compactPanelStyle()}>
          <div style={compactEyebrowStyle()}>Selected day</div>
          <div style={compactValueStyle("#a6e3a1", 18)}>{formatShortDate(viewYear, viewMonth, selectedDay)}</div>
          <div style={compactDetailStyle()}>
            {selectedDayState?.totalCount || 0} scheduled item{selectedDayState?.totalCount === 1 ? "" : "s"} on this date
          </div>
        </div>
        <div style={compactPanelStyle()}>
          <div style={compactEyebrowStyle()}>Status</div>
          <div style={compactMetricRowStyle()}>
            <span style={{ fontSize: 11, lineHeight: 1.35, color: "rgba(205,214,244,0.62)" }}>Unpaid</span>
            <span style={{ fontSize: 16, lineHeight: 1, color: "#a6e3a1", fontWeight: 500, fontVariantNumeric: "tabular-nums" }}>{selectedDayState?.activeCount || 0}</span>
          </div>
          <div style={compactMetricRowStyle()}>
            <span style={{ fontSize: 11, lineHeight: 1.35, color: "rgba(205,214,244,0.62)" }}>Paid</span>
            <span style={{ fontSize: 16, lineHeight: 1, color: "#a6e3a1", fontWeight: 500, fontVariantNumeric: "tabular-nums" }}>{selectedDayState?.completedCount || 0}</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={bandGridStyle(layout)}>
      <BillSupportCard bill={selectedBill} compact={compactBand} />
      <div style={stackStyle()}>
        <MetricCard
          label="Selected day"
          value={formatShortDate(viewYear, viewMonth, selectedDay)}
          detail={`${selectedDayState?.totalCount || 0} scheduled item${selectedDayState?.totalCount === 1 ? "" : "s"} on this date`}
          accent="#a6e3a1"
          compact={compactBand}
        />
        <MetricCard
          label="Unpaid"
          value={`${selectedDayState?.activeCount || 0}`}
          detail={selectedDayState?.activeCount ? "Still waiting to clear" : "Nothing outstanding here"}
          accent="#a6e3a1"
          compact={compactBand}
        />
      </div>
      <div style={stackStyle()}>
        <MetricCard
          label="Paid"
          value={`${selectedDayState?.completedCount || 0}`}
          detail={selectedDayState?.completedCount ? "Already cleared on this day" : "No cleared items here"}
          accent="#a6e3a1"
          compact={compactBand}
        />
        <div style={{ ...panelStyle(), display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: compactBand ? 6 : 8 }}>
          <RailFactTile label="Amount" value={formatAmount(selectedBill?.amount || 0)} color="#a6e3a1" compact={compactBand} />
          <RailFactTile label="Type" value={selectedBill?.type === "transfer" ? "Transfer" : "Bill"} compact={compactBand} />
        </div>
      </div>
    </div>
  );
}

function DaySupport({ layout, selectedDayState, selectedDay, viewYear, viewMonth }) {
  const compactBand = !layout.stacked;
  const allItems = [...(selectedDayState?.activeItems || []), ...(selectedDayState?.completedItems || [])];
  const dueTotal = allItems.reduce((sum, bill) => sum + (Number(bill.amount) || 0), 0);
  const previewItems = allItems.slice(0, compactBand ? 2 : 3);
  const extraCount = Math.max(0, allItems.length - previewItems.length);

  if (compactBand) {
    return (
      <div style={bandGridStyle(layout)}>
        <div style={compactPanelStyle("#a6e3a1", true)}>
          <div style={compactEyebrowStyle()}>Selected day</div>
          <div style={compactValueStyle("#a6e3a1", 18)}>{formatShortDate(viewYear, viewMonth, selectedDay)}</div>
          <div style={compactDetailStyle()}>
            {selectedDayState?.totalCount || 0} scheduled item{selectedDayState?.totalCount === 1 ? "" : "s"} on this date
          </div>
        </div>
        <div style={compactPanelStyle()}>
          <div style={compactEyebrowStyle()}>Due total</div>
          <div style={compactMetricRowStyle()}>
            <span style={{ fontSize: 11, lineHeight: 1.35, color: "rgba(205,214,244,0.62)" }}>Unpaid</span>
            <span style={{ fontSize: 16, lineHeight: 1, color: "#a6e3a1", fontWeight: 500, fontVariantNumeric: "tabular-nums" }}>{selectedDayState?.activeCount || 0}</span>
          </div>
          <div style={compactMetricRowStyle()}>
            <span style={{ fontSize: 11, lineHeight: 1.35, color: "rgba(205,214,244,0.62)" }}>Paid</span>
            <span style={{ fontSize: 16, lineHeight: 1, color: "#a6e3a1", fontWeight: 500, fontVariantNumeric: "tabular-nums" }}>{selectedDayState?.completedCount || 0}</span>
          </div>
        </div>
        <div style={{ ...compactPanelStyle(), gap: 5 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
            <div style={compactEyebrowStyle()}>On the grid</div>
            {extraCount > 0 ? <RailMetaChip tone="quiet" compact>+{extraCount} more</RailMetaChip> : null}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {previewItems.map((bill) => (
              <div key={bill.id} style={{ display: "grid", gridTemplateColumns: "auto minmax(0, 1fr)", gap: 8, alignItems: "baseline" }}>
                <span style={{ fontSize: 10, fontWeight: 600, color: bill.paid ? "#a6e3a1" : urgencyColor(daysUntil(bill.next_date)).accent, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>
                  {formatAmount(bill.amount).replace(".00", "")}
                </span>
                <span style={{ minWidth: 0, fontSize: 11, lineHeight: 1.35, color: bill.paid ? "rgba(205,214,244,0.52)" : "rgba(205,214,244,0.7)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textDecoration: bill.paid ? "line-through" : "none", textDecorationColor: "rgba(205,214,244,0.24)" }}>
                  {bill.name}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={bandGridStyle(layout)}>
      <div style={stackStyle()}>
        <MetricCard
          label="Selected day"
          value={formatShortDate(viewYear, viewMonth, selectedDay)}
          detail={`${selectedDayState?.totalCount || 0} scheduled item${selectedDayState?.totalCount === 1 ? "" : "s"} on this date`}
          accent="#a6e3a1"
          compact={compactBand}
        />
        <MetricCard
          label="Due total"
          value={formatAmount(dueTotal)}
          detail={selectedDayState?.activeCount ? "Outstanding amount still on this date" : "Everything here is already cleared"}
          accent="#a6e3a1"
          compact={compactBand}
        />
      </div>
      <div style={stackStyle()}>
        <MetricCard
          label="Unpaid"
          value={`${selectedDayState?.activeCount || 0}`}
          detail={selectedDayState?.activeCount ? "Still waiting to clear" : "Nothing outstanding here"}
          accent="#a6e3a1"
          compact={compactBand}
        />
        <MetricCard
          label="Paid"
          value={`${selectedDayState?.completedCount || 0}`}
          detail={selectedDayState?.completedCount ? "Already cleared on this day" : "No cleared items here"}
          accent="#a6e3a1"
          compact={compactBand}
        />
      </div>
      <div style={{ ...panelStyle(), display: "flex", flexDirection: "column", gap: compactBand ? 6 : 8 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 2, textTransform: "uppercase", color: "rgba(205,214,244,0.44)" }}>
            On the grid
          </div>
          {extraCount > 0 ? <RailMetaChip tone="quiet" compact={compactBand}>+{extraCount} more</RailMetaChip> : null}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: compactBand ? 4 : 6 }}>
          {previewItems.map((bill) => (
            <div key={bill.id} style={{ display: "grid", gridTemplateColumns: "auto minmax(0, 1fr)", gap: 8, alignItems: "baseline" }}>
              <span style={{ fontSize: compactBand ? 10 : 10.5, fontWeight: 600, color: bill.paid ? "#a6e3a1" : urgencyColor(daysUntil(bill.next_date)).accent, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>
                {formatAmount(bill.amount).replace(".00", "")}
              </span>
              <span style={{ minWidth: 0, fontSize: compactBand ? 11 : 11.5, lineHeight: 1.35, color: bill.paid ? "rgba(205,214,244,0.52)" : "rgba(205,214,244,0.7)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textDecoration: bill.paid ? "line-through" : "none", textDecorationColor: "rgba(205,214,244,0.24)" }}>
                {bill.name}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function renderBillsWorkspaceSupport(props) {
  const model = getOverviewModel(props);
  const selectedBill = [...(props.selectedDayState?.activeItems || []), ...(props.selectedDayState?.completedItems || [])]
    .find((bill) => String(bill.id) === String(props.selectedItemId))
    || null;
  const handleSelectDay = (day) => {
    props.setDeadlineEditor?.(null);
    props.setSelectedItemId?.(null);
    props.setSelectedDay?.(day);
  };

  if (props.mode === "detail" && selectedBill) {
    return (
      <DetailSupport
        layout={props.layout}
        selectedBill={selectedBill}
        selectedDayState={props.selectedDayState}
        selectedDay={props.selectedDay}
        viewYear={props.viewYear}
        viewMonth={props.viewMonth}
      />
    );
  }

  if (props.mode === "detail") {
    return (
      <DaySupport
        layout={props.layout}
        selectedDayState={props.selectedDayState}
        selectedDay={props.selectedDay}
        viewYear={props.viewYear}
        viewMonth={props.viewMonth}
      />
    );
  }

  if (props.mode === "empty") {
    return (
      <EmptySupport
        layout={props.layout}
        model={model}
        itemsByDay={props.itemsByDay}
        selectedDay={props.selectedDay}
        viewYear={props.viewYear}
        viewMonth={props.viewMonth}
        activeView={props.activeView}
        onSelectDay={handleSelectDay}
      />
    );
  }

  return (
    <OverviewSupport
      layout={props.layout}
      model={model}
      computed={props.computed}
      data={props.data}
      itemsByDay={props.itemsByDay}
      viewYear={props.viewYear}
      viewMonth={props.viewMonth}
    />
  );
}
