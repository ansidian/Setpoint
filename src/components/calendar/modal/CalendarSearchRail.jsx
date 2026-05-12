import { useEffect, useLayoutEffect, useRef } from "react";
import { Search, X } from "lucide-react";
import { getLocationDisplayLabel } from "../../../lib/calendar-links.js";
import {
  activationTargetFromCalendarSearchResult,
  calendarSearchPlaceholder,
  calendarSearchStateLabel,
  calendarSearchStartIndex,
  calendarSearchResultNavigable,
  shouldShowCalendarSearchSkeleton,
} from "../../../hooks/calendar/calendarModalSearchModel.js";
import { formatAgendaHeaderLabel } from "../views/agenda/agendaDateModel.js";
import { colorWithAlpha } from "../views/events/eventsAgendaColor.js";
import { WeatherHeader } from "../views/events/EventsAgendaRailParts.jsx";

const DASHBOARD_CALENDAR_TZ = "America/Los_Angeles";
const SEARCH_RESULT_SCROLL_TOP_OFFSET = 44;

function parseDateKey(value) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
}

function todayDateKey() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: DASHBOARD_CALENDAR_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function resultIsPast(result, todayKey = todayDateKey()) {
  return !!result?.itemDate && result.itemDate < todayKey;
}

function weatherByDate(weatherData, todayKey = todayDateKey()) {
  const map = new Map();
  for (const day of weatherData?.dailyForecast || []) {
    if (!day?.dateKey) continue;
    map.set(day.dateKey, {
      dateKey: day.dateKey,
      high: day.high,
      low: day.low,
      icon: day.icon,
      summary: day.summary || "",
    });
  }
  if (
    weatherData
    && todayKey
    && (weatherData.temp != null || weatherData.high != null || weatherData.low != null || weatherData.icon)
  ) {
    map.set(todayKey, {
      ...(map.get(todayKey) || {}),
      dateKey: todayKey,
      high: weatherData.high ?? weatherData.temp ?? null,
      low: weatherData.low ?? weatherData.temp ?? null,
      icon: weatherData.icon,
      summary: weatherData.summary || map.get(todayKey)?.summary || "",
    });
  }
  return map;
}

function resultPrimaryMeta(result) {
  const value = String(result?.subtitle || result?.meta || "").trim();
  if (!value || value === result?.sourceLabel) return "";
  return value.replace(/^All day\b/, "all-day");
}

function resultDetail(result) {
  if (result?.type === "event" && result?.location) {
    return getLocationDisplayLabel(result.location);
  }
  const value = String(result?.subtitle || result?.meta || "").trim();
  if (!value || value === result?.sourceLabel) return "";
  return value;
}

function groupResultsByDate(results = []) {
  const groups = [];
  results.forEach((result, index) => {
    const dateKey = result.itemDate || "undated";
    const entry = { result, index };
    const lastGroup = groups[groups.length - 1];
    if (lastGroup?.dateKey === dateKey) {
      lastGroup.results.push(entry);
    } else {
      groups.push({ dateKey, results: [entry] });
    }
  });
  return groups;
}

function resultGroupCenterDateKey(groups, todayKey = todayDateKey()) {
  if (!groups.length) return null;
  const datedGroups = groups.filter((group) => parseDateKey(group.dateKey));
  if (!datedGroups.length) return groups[0]?.dateKey || null;
  const flatResults = groups.flatMap((group) => group.results.map(({ result }) => result));
  const targetIndex = calendarSearchStartIndex(flatResults, todayKey);
  const target = flatResults[targetIndex];
  return target?.itemDate || datedGroups[datedGroups.length - 1]?.dateKey || null;
}

function centerElementInScroller(scroller, element) {
  if (!scroller || !element) return null;
  const scrollerRect = scroller.getBoundingClientRect();
  const rect = element.getBoundingClientRect();
  const visibleHeight = scroller.clientHeight || scrollerRect.height || 0;
  const nextScrollTop = Math.max(
    0,
    scroller.scrollTop + rect.top - scrollerRect.top - Math.max(0, (visibleHeight - rect.height) / 2),
  );
  if (typeof scroller.scrollTo === "function") {
    scroller.scrollTo({ top: nextScrollTop, behavior: "auto" });
  } else {
    scroller.scrollTop = nextScrollTop;
  }
  return nextScrollTop;
}

function scrollElementNearestInScroller(
  scroller,
  element,
  {
    offsetTop = SEARCH_RESULT_SCROLL_TOP_OFFSET,
    offsetBottom = SEARCH_RESULT_SCROLL_TOP_OFFSET,
  } = {},
) {
  if (!scroller || !element) return null;
  const scrollerRect = scroller.getBoundingClientRect();
  const rect = element.getBoundingClientRect();
  const visibleHeight = scroller.clientHeight || scrollerRect.height || 0;
  if (visibleHeight <= 0) return null;
  const upperEdge = scrollerRect.top + offsetTop;
  const lowerEdge = scrollerRect.bottom - offsetBottom;
  if (rect.top >= upperEdge && rect.bottom <= lowerEdge) return null;
  const rawScrollTop = Math.max(
    0,
    rect.top < upperEdge
      ? scroller.scrollTop + rect.top - upperEdge
      : scroller.scrollTop + rect.bottom - lowerEdge,
  );
  const scrollHeight = scroller.scrollHeight || 0;
  const maxScrollTop = scrollHeight > visibleHeight ? scrollHeight - visibleHeight : rawScrollTop;
  const nextScrollTop = Math.min(rawScrollTop, maxScrollTop);
  const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
  const behavior = reduceMotion ? "auto" : "smooth";
  if (typeof scroller.scrollTo === "function") {
    scroller.scrollTo({ top: nextScrollTop, behavior });
  } else {
    scroller.scrollTop = nextScrollTop;
  }
  return nextScrollTop;
}

function deadlineSelectionIdCandidates(result, dateKey) {
  if (result?.type !== "deadline") return [];
  const rawId = result.payload?.id || result.itemId || result.activation?.itemId;
  if (rawId == null) return [];
  const source = String(
    result.payload?.source
    || result.activation?.source
    || result.coverageKey
    || "",
  ).toLowerCase();
  const sources = new Set([source].filter(Boolean));
  if (source === "ctm") sources.add("canvas");
  if (source === "canvas") sources.add("ctm");
  const id = String(rawId);
  return [...sources].flatMap((sourceKey) => [
    `${sourceKey}:${id}`,
    dateKey ? `${sourceKey}:${id}-${dateKey}` : null,
  ]).filter(Boolean);
}

function resultMatchesSelection(result, selectedItemId, selectedDateKey) {
  if (selectedItemId == null || !selectedDateKey) return false;
  const target = activationTargetFromCalendarSearchResult(result);
  if (target?.dateKey !== selectedDateKey) return false;
  if (String(target.itemId) === String(selectedItemId)) return true;
  return deadlineSelectionIdCandidates(result, target.dateKey)
    .some((candidate) => candidate === String(selectedItemId));
}

function buttonChromeStyle(active = false) {
  return {
    width: 30,
    height: 30,
    borderRadius: 8,
    border: `1px solid ${active ? "rgba(203,166,218,0.28)" : "rgba(255,255,255,0.07)"}`,
    background: active ? "rgba(203,166,218,0.12)" : "rgba(255,255,255,0.035)",
    color: active ? "#cba6da" : "rgba(205,214,244,0.72)",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
    transform: "translateY(0)",
    transition: "transform 150ms, background 150ms, border-color 150ms, color 150ms",
    flexShrink: 0,
  };
}

function applyButtonHover(event) {
  event.currentTarget.style.transform = "translateY(-1px)";
  event.currentTarget.style.background = "rgba(255,255,255,0.07)";
  event.currentTarget.style.borderColor = "rgba(255,255,255,0.14)";
}

function resetButtonHover(event, active = false) {
  event.currentTarget.style.transform = "translateY(0)";
  event.currentTarget.style.background = active ? "rgba(203,166,218,0.12)" : "rgba(255,255,255,0.035)";
  event.currentTarget.style.borderColor = active ? "rgba(203,166,218,0.28)" : "rgba(255,255,255,0.07)";
}

function SearchResultRow({ result, highlighted, selected, onActivate, rowRef }) {
  const color = result.sourceColor || "#89b4fa";
  const past = resultIsPast(result);
  const primaryMeta = resultPrimaryMeta(result);
  const detail = resultDetail(result);
  const hasDetail = detail && detail !== primaryMeta;
  return (
    <button
      type="button"
      ref={rowRef}
      data-testid="calendar-search-result-row"
      data-highlighted={highlighted ? "true" : "false"}
      data-selected={selected ? "true" : "false"}
      data-past={past ? "true" : "false"}
      data-source-color={color}
      onMouseEnter={(event) => {
        event.currentTarget.style.transform = "translateY(-1px)";
        if (!selected) event.currentTarget.style.borderColor = "rgba(255,255,255,0.12)";
      }}
      onMouseLeave={(event) => {
        event.currentTarget.style.transform = "translateY(0)";
        if (!selected) event.currentTarget.style.borderColor = "rgba(255,255,255,0.055)";
      }}
      onClick={(event) => onActivate?.(event)}
      style={{
        width: "100%",
        minHeight: 58,
        display: "grid",
        gridTemplateColumns: "14px minmax(0, 1fr)",
        alignItems: "start",
        gap: 8,
        padding: "8px 9px",
        borderRadius: 8,
        border: selected ? `1px solid ${colorWithAlpha(color, 0.75)}` : "1px solid rgba(255,255,255,0.055)",
        background: selected ? colorWithAlpha(color, 0.18) : "rgba(255,255,255,0.025)",
        color: "#cdd6f4",
        textAlign: "left",
        cursor: "pointer",
        fontFamily: "inherit",
        opacity: past ? 0.48 : 1,
        transition: "transform 170ms cubic-bezier(0.16, 1, 0.3, 1), background-color 170ms cubic-bezier(0.16, 1, 0.3, 1), border-color 170ms cubic-bezier(0.16, 1, 0.3, 1)",
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: 8,
          height: 8,
          marginTop: 5,
          borderRadius: 999,
          border: `1.5px solid ${color}`,
          background: "transparent",
          boxShadow: selected ? `0 0 8px ${color}55` : "none",
        }}
      />
      <span style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 3 }}>
        {primaryMeta ? (
          <span
            style={{
              fontSize: 10.5,
              lineHeight: 1.25,
              fontWeight: 700,
              color: "rgba(205,214,244,0.68)",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {primaryMeta}
          </span>
        ) : null}
        <span
          data-title-wrap="two-lines"
          style={{
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            fontSize: 12,
            lineHeight: 1.25,
            fontWeight: 600,
            color: "#cdd6f4",
            overflow: "hidden",
          }}
        >
          {result.title || "Untitled"}
        </span>
        {hasDetail ? (
          <span
            style={{
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              fontSize: 10.5,
              lineHeight: 1.3,
              color: "rgba(166,173,200,0.64)",
              overflow: "hidden",
            }}
          >
            {detail}
          </span>
        ) : null}
      </span>
    </button>
  );
}

function SearchDateHeader({ dateKey, todayKey, weather, onActivate, registerHeader }) {
  const label = parseDateKey(dateKey) ? formatAgendaHeaderLabel(dateKey, todayKey) : dateKey || "";
  const isToday = dateKey === todayKey;
  return (
    <button
      type="button"
      ref={(node) => registerHeader?.(dateKey, node)}
      data-testid="calendar-search-date-header"
      data-agenda-date-header="true"
      data-date-key={dateKey}
      aria-label={`Select ${label.toLowerCase()}`}
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
        border: 0,
        borderRadius: 0,
        background: "#1f1f24",
        color: isToday ? "#0495FF" : "#B1B1B3",
        fontFamily: "inherit",
        fontSize: 12,
        fontWeight: 800,
        letterSpacing: 1.35,
        lineHeight: 1,
        textAlign: "left",
        textTransform: "uppercase",
        cursor: "pointer",
        transition: "background-color 180ms cubic-bezier(0.16, 1, 0.3, 1), color 180ms cubic-bezier(0.16, 1, 0.3, 1), box-shadow 180ms cubic-bezier(0.16, 1, 0.3, 1)",
      }}
      onClick={() => onActivate?.(dateKey)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onActivate?.(dateKey);
        }
      }}
      onMouseEnter={(event) => {
        event.currentTarget.style.background = "#23232a";
      }}
      onMouseLeave={(event) => {
        event.currentTarget.style.background = "#1f1f24";
      }}
    >
      <span>{label}</span>
      <WeatherHeader weather={weather} />
    </button>
  );
}

function SearchSkeleton() {
  return (
    <div
      data-testid="calendar-search-skeleton"
      aria-hidden="true"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 8,
        paddingTop: 8,
      }}
    >
      <style>
        {`
          @keyframes calendar-search-skeleton-sheen {
            0% { background-position: 180% 0; }
            100% { background-position: -180% 0; }
          }
          .calendar-search-skeleton-block {
            background: linear-gradient(90deg, rgba(255,255,255,0.045), rgba(255,255,255,0.095), rgba(255,255,255,0.045));
            background-size: 220% 100%;
            animation: calendar-search-skeleton-sheen 1200ms ease-in-out infinite;
          }
          @media (prefers-reduced-motion: reduce) {
            .calendar-search-skeleton-block {
              animation: none;
              background: rgba(255,255,255,0.065);
            }
          }
        `}
      </style>
      {Array.from({ length: 6 }).map((_, index) => (
        <div
          key={index}
          data-testid="calendar-search-skeleton-row"
          style={{
            minHeight: 58,
            display: "grid",
            gridTemplateColumns: "14px minmax(0, 1fr)",
            gap: 8,
            padding: "8px 9px",
            borderRadius: 8,
            border: "1px solid rgba(255,255,255,0.045)",
            background: "rgba(255,255,255,0.018)",
          }}
        >
          <span
            className="calendar-search-skeleton-block"
            style={{
              width: 8,
              height: 8,
              marginTop: 5,
              borderRadius: 999,
            }}
          />
          <span style={{ display: "flex", flexDirection: "column", gap: 7, minWidth: 0 }}>
            <span
              className="calendar-search-skeleton-block"
              style={{
                width: index % 2 === 0 ? "42%" : "34%",
                height: 9,
                borderRadius: 999,
              }}
            />
            <span
              className="calendar-search-skeleton-block"
              style={{
                width: index % 3 === 0 ? "86%" : "72%",
                height: 12,
                borderRadius: 999,
              }}
            />
            <span
              className="calendar-search-skeleton-block"
              style={{
                width: index % 2 === 0 ? "58%" : "66%",
                height: 9,
                borderRadius: 999,
              }}
            />
          </span>
        </div>
      ))}
    </div>
  );
}

export default function CalendarSearchRail({ search, layoutMode = "three-rail", weatherData = null }) {
  const inputRef = useAutoFocusInput(search);
  const scrollerRef = useRef(null);
  const resultRowRefs = useRef(new Map());
  const headerRefs = useRef(new Map());
  const lastCenteredSignatureRef = useRef("");
  const lastActivationRef = useRef({
    signature: "",
    index: -1,
    direction: 0,
    nextIndex: -1,
  });
  const stateLabel = calendarSearchStateLabel(search);
  const showSkeleton = shouldShowCalendarSearchSkeleton(search);
  const compact = layoutMode === "stacked-replaces-agenda";
  const resultGroups = groupResultsByDate(search.results);
  const todayKey = todayDateKey();
  const weatherMap = weatherByDate(weatherData, todayKey);
  const resultSignature = `${search.query.trim()}|${search.results.map((result) => (
    result.id || `${result.type}-${result.itemId}-${result.itemDate}`
  )).join("|")}`;

  const resultNavigable = (result, index) => {
    if (!calendarSearchResultNavigable(result)) return false;
    return search.isResultNavigable?.(result, index) ?? true;
  };
  const nextActivationIndex = ({ highlightedIndex, direction, includeCurrent }) => {
    const count = search.results.length;
    if (!count) return -1;
    const normalized = highlightedIndex < 0 || highlightedIndex >= count ? 0 : highlightedIndex;
    const step = direction >= 0 ? 1 : -1;
    for (let offset = includeCurrent ? 0 : 1; offset <= count; offset += 1) {
      const index = (normalized + (offset * step) + count) % count;
      if (resultNavigable(search.results[index], index)) return index;
    }
    return -1;
  };

  const activateSearchResultAtIndex = (index, direction = 1) => {
    const result = search.results[index];
    if (!result) return false;
    const rowElement = resultRowRefs.current.get(index) || null;
    const activationContext = search.getResultActivationContext?.(result, index, {
      anchorElement: rowElement,
      sourceCellElement: rowElement,
    }) || { anchorKind: "grid-chip" };
    search.activateResult(result, activationContext);
    const nextIndex = nextActivationIndex({
      highlightedIndex: index,
      direction,
      includeCurrent: false,
    });
    const highlightedNextIndex = nextIndex >= 0 ? nextIndex : index;
    search.setHighlightedIndex?.(highlightedNextIndex);
    const nextScrollTop = scrollElementNearestInScroller(scrollerRef.current, rowElement);
    if (nextScrollTop != null) search.setScrollTop?.(nextScrollTop);
    lastActivationRef.current = {
      signature: resultSignature,
      index,
      direction,
      nextIndex: highlightedNextIndex,
    };
    return true;
  };

  const handleInputKeyDown = (event) => {
    if (event.key === "Enter") {
      const direction = event.shiftKey ? -1 : 1;
      const lastActivation = lastActivationRef.current;
      const directionChangedFromQueuedHighlight = (
        lastActivation.signature === resultSignature
        && lastActivation.index >= 0
        && lastActivation.direction !== 0
        && lastActivation.direction !== direction
        && lastActivation.nextIndex === search.highlightedIndex
      );
      const index = nextActivationIndex({
        highlightedIndex: directionChangedFromQueuedHighlight ? lastActivation.index : search.highlightedIndex,
        direction,
        includeCurrent: !directionChangedFromQueuedHighlight,
      });
      if (index >= 0 && activateSearchResultAtIndex(index, direction)) {
        event.preventDefault?.();
        event.stopPropagation?.();
        return;
      }
    }
    search.handleInputKeyDown(event);
  };

  useEffect(() => {
    lastActivationRef.current = {
      signature: resultSignature,
      index: -1,
      direction: 0,
      nextIndex: -1,
    };
  }, [resultSignature]);

  useLayoutEffect(() => {
    if (search.autoCenterResults === false) return undefined;
    if (!search.open || search.pending || !resultGroups.length) return undefined;
    if (lastCenteredSignatureRef.current === resultSignature) return undefined;
    lastCenteredSignatureRef.current = resultSignature;
    const targetDateKey = resultGroupCenterDateKey(resultGroups);
    const id = window.requestAnimationFrame(() => {
      const nextScrollTop = centerElementInScroller(scrollerRef.current, headerRefs.current.get(targetDateKey));
      if (nextScrollTop != null) {
        search.setScrollTop?.(nextScrollTop);
        search.markResultsAutoCentered?.();
      }
    });
    return () => window.cancelAnimationFrame(id);
  }, [resultGroups, resultSignature, search]);

  useLayoutEffect(() => {
    if (!search.open || search.autoCenterResults !== false) return;
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const nextScrollTop = Number.isFinite(search.scrollTop) ? Math.max(0, search.scrollTop) : 0;
    if (Math.abs(scroller.scrollTop - nextScrollTop) > 1) {
      scroller.scrollTop = nextScrollTop;
    }
  }, [resultSignature, search.autoCenterResults, search.open, search.scrollTop]);

  return (
    <aside
      data-testid="calendar-search-rail"
      data-search-layout={layoutMode}
      data-suspend-calendar-hotkeys="true"
      style={{
        minWidth: 0,
        minHeight: 0,
        height: compact ? "auto" : "100%",
        maxHeight: compact ? 300 : "none",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        borderRadius: 16,
        border: "1px solid rgba(255,255,255,0.06)",
        background: "linear-gradient(180deg, rgba(255,255,255,0.04), rgba(255,255,255,0.022))",
        boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)",
      }}
    >
      <div
        style={{
          padding: 10,
          borderBottom: "1px solid rgba(255,255,255,0.055)",
          display: "flex",
          flexDirection: "column",
          gap: 8,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7, minWidth: 0 }}>
            <Search size={13} aria-hidden="true" color="rgba(203,166,218,0.78)" />
            <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1.3, textTransform: "uppercase", color: "rgba(205,214,244,0.68)" }}>
              Search
            </span>
          </div>
          <button
            type="button"
            aria-label="Close search"
            onClick={search.closeSearch}
            onMouseEnter={applyButtonHover}
            onMouseLeave={(event) => resetButtonHover(event)}
            data-calendar-focus-ring="true"
            style={buttonChromeStyle(false)}
          >
            <X size={14} />
          </button>
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "14px minmax(0, 1fr) auto",
            alignItems: "center",
            gap: 8,
            minHeight: 38,
            padding: "0 8px",
            borderRadius: 10,
            border: "1px solid rgba(255,255,255,0.075)",
            background: "rgba(49,50,68,0.68)",
          }}
        >
          <Search size={13} aria-hidden="true" color="rgba(205,214,244,0.42)" />
          <input
            ref={inputRef}
            value={search.query}
            onChange={(event) => search.setQuery(event.target.value)}
            onKeyDown={handleInputKeyDown}
            aria-label="Calendar search"
            placeholder={calendarSearchPlaceholder(search.scope)}
            data-testid="calendar-search-input"
            style={{
              minWidth: 0,
              width: "100%",
              height: 34,
              border: 0,
              outline: "none",
              background: "transparent",
              color: "#cdd6f4",
              fontFamily: "inherit",
              fontSize: 12,
              letterSpacing: 0,
            }}
          />
          {search.query ? (
            <button
              type="button"
              aria-label="Clear search"
              onClick={search.clearQuery}
              onMouseEnter={applyButtonHover}
              onMouseLeave={(event) => resetButtonHover(event)}
              data-calendar-focus-ring="true"
              style={{ ...buttonChromeStyle(false), width: 24, height: 24, borderRadius: 7 }}
            >
              <X size={12} />
            </button>
          ) : null}
        </div>
        {stateLabel ? (
          <div
            data-testid="calendar-search-state"
            role={search.pending || search.error ? "status" : undefined}
            style={{
              minHeight: 14,
              fontSize: 10.5,
              color: search.error ? "#f38ba8" : "rgba(205,214,244,0.48)",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {stateLabel}
          </div>
        ) : <div style={{ minHeight: 14 }} />}
      </div>
      <div
        ref={scrollerRef}
        role="listbox"
        aria-label="Calendar search results"
        aria-busy={showSkeleton ? "true" : undefined}
        data-testid="calendar-search-results"
        data-calendar-local-scroll="true"
        onScroll={(event) => search.setScrollTop?.(event.currentTarget.scrollTop)}
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          overscrollBehavior: "contain",
          padding: `0 10px ${SEARCH_RESULT_SCROLL_TOP_OFFSET}px`,
          scrollPaddingTop: SEARCH_RESULT_SCROLL_TOP_OFFSET,
          scrollPaddingBottom: SEARCH_RESULT_SCROLL_TOP_OFFSET,
          display: "flex",
          flexDirection: "column",
          gap: 0,
          background: "#1f1f24",
          isolation: "isolate",
        }}
      >
        {showSkeleton ? <SearchSkeleton /> : null}
        {resultGroups.map((group) => (
          <section key={group.dateKey} data-date-key={group.dateKey} style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0, paddingBottom: 14 }}>
            <SearchDateHeader
              dateKey={group.dateKey}
              todayKey={todayKey}
              weather={weatherMap.get(group.dateKey) || null}
              onActivate={(dateKey) => {
                const firstIndex = group.results[0]?.index;
                if (Number.isInteger(firstIndex)) search.setHighlightedIndex?.(firstIndex);
                search.activateDateHeader?.(dateKey);
              }}
              registerHeader={(dateKey, node) => {
                if (node) headerRefs.current.set(dateKey, node);
                else headerRefs.current.delete(dateKey);
              }}
            />
            {group.results.map(({ result, index }) => (
              <SearchResultRow
                key={`${result.id || `${result.type}-${result.itemId}-${result.itemDate}`}:${index}`}
                result={result}
                highlighted={index === search.highlightedIndex}
                selected={resultMatchesSelection(result, search.selectedItemId, search.selectedDateKey)}
                rowRef={(node) => {
                  if (node) resultRowRefs.current.set(index, node);
                  else resultRowRefs.current.delete(index);
                }}
                onActivate={(event) => search.activateResult(result, {
                  anchorElement: event.currentTarget,
                  sourceCellElement: event.currentTarget,
                  anchorKind: "search-result-row",
                })}
              />
            ))}
          </section>
        ))}
      </div>
    </aside>
  );
}

function useAutoFocusInput(search) {
  const ref = useRef(null);
  const previousScopeRef = useRef(search.scope);
  const previousFocusRequestIdRef = useRef(0);

  useEffect(() => {
    if (!search.open || !search.focusRequestId) return;
    const scopeChanged = previousScopeRef.current && previousScopeRef.current !== search.scope;
    const focusRequested = previousFocusRequestIdRef.current !== search.focusRequestId;
    previousScopeRef.current = search.scope;
    previousFocusRequestIdRef.current = search.focusRequestId;
    if (!scopeChanged && !focusRequested) return;
    ref.current?.focus();
    if (!scopeChanged && search.focusSelectAll !== false) ref.current?.select?.();
    else {
      const valueLength = ref.current?.value?.length || 0;
      ref.current?.setSelectionRange?.(valueLength, valueLength);
    }
  }, [search.focusRequestId, search.focusSelectAll, search.open, search.scope]);
  return ref;
}
