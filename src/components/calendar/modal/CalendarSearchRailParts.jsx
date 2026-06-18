import { Search, X } from "lucide-react";
import { getLocationDisplayLabel } from "../../../lib/calendar-links.js";
import { calendarSearchPlaceholder } from "../../../hooks/calendar/calendarModalSearchModel.js";
import GoogleSpecialDateBadge from "../GoogleSpecialDateBadge.jsx";
import {
  googleSpecialDateAccent,
  isGoogleSpecialDateEvent,
} from "../googleSpecialDateModel.js";
import { formatAgendaHeaderLabel } from "../views/agenda/agendaDateModel.js";
import { colorWithAlpha } from "../views/events/eventsAgendaColor.js";
import { WeatherHeader } from "../views/events/EventsAgendaRailParts.jsx";

function parseDateKey(value) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
}

function resultIsPast(result, todayKey) {
  return !!result?.itemDate && result.itemDate < todayKey;
}

function resultPrimaryMeta(result) {
  if (isGoogleSpecialDateEvent(result)) return "";
  const value = String(result?.subtitle || result?.meta || "").trim();
  if (!value || value === result?.sourceLabel) return "";
  return value.replace(/^All day\b/, "all-day");
}

function resultDetail(result) {
  if (isGoogleSpecialDateEvent(result)) return "";
  if (result?.type === "event" && result?.location) {
    return getLocationDisplayLabel(result.location);
  }
  const value = String(result?.subtitle || result?.meta || "").trim();
  if (!value || value === result?.sourceLabel) return "";
  return value;
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

export function CalendarSearchRailHeader({
  inputRef,
  search,
  stateLabel,
  onInputKeyDown,
}) {
  return (
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
          onKeyDown={onInputKeyDown}
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
            color: search.error ? "#f38ba8" : "var(--color-text-faint)",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {stateLabel}
        </div>
      ) : <div style={{ minHeight: 14 }} />}
    </div>
  );
}

export function SearchResultRow({
  result,
  highlighted,
  selected,
  onActivate,
  rowRef,
  todayKey,
}) {
  const specialDate = isGoogleSpecialDateEvent(result);
  const color = specialDate ? googleSpecialDateAccent(result) : result.sourceColor || "#89b4fa";
  const past = resultIsPast(result, todayKey);
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
      data-visual-state={selected ? "selected" : highlighted ? "highlighted" : "idle"}
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
        gridTemplateColumns: specialDate ? "24px minmax(0, 1fr)" : "14px minmax(0, 1fr)",
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
      {specialDate ? (
        <GoogleSpecialDateBadge
          item={result}
          color={color}
          selected={selected}
          active={highlighted}
          variant="search"
        />
      ) : (
        <span
          data-calendar-search-source-dot="true"
          data-source-color={color}
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
      )}
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
              color: "rgba(166,173,200,0.75)",
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

export function SearchDateHeader({ dateKey, todayKey, weather, onActivate, registerHeader }) {
  const label = parseDateKey(dateKey) ? formatAgendaHeaderLabel(dateKey, todayKey) : dateKey || "";
  const isToday = dateKey === todayKey;
  return (
    <button
      type="button"
      ref={(node) => registerHeader?.(dateKey, node)}
      data-testid="calendar-search-date-header"
      data-agenda-date-header="true"
      data-date-key={dateKey}
      data-date-tone={isToday ? "today" : "normal"}
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

export function SearchSkeleton() {
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
