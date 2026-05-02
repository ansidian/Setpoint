import { getCalendarViewMeta } from "./calendarEmptyStateMeta.js";
import { emptyDayPrimaryAction } from "./calendarOverviewModel.js";
import {
  EmptyDayCard,
  EmptyDayPrimaryAction,
} from "./CalendarRailPrimitives.jsx";
import { railContentStyle, railStaticStyle } from "./calendarRailStyles.js";
import { NearbyActivityCard } from "./NearbyActivityCard.jsx";

export function CalendarSelectedDayEmptyRail(props) {
  const primaryAction = emptyDayPrimaryAction(props);
  const model = getCalendarViewMeta(props.view);
  const handleSelectDay = (day) => {
    props.setDeadlineEditor?.(null);
    props.setSelectedItemId?.(null);
    props.setSelectedDay?.(day);
  };

  return (
    <div data-testid="calendar-selected-empty-rail-frame" style={railStaticStyle()}>
      <div style={{ ...railContentStyle({ compact: true }), justifyContent: "space-between" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 12, flexShrink: 0 }}>
          <EmptyDayCard
            model={model}
            viewYear={props.viewYear}
            viewMonth={props.viewMonth}
            selectedDay={props.selectedDay}
            compact
          />

          <NearbyActivityCard
            model={model}
            activeView={props.activeView}
            itemsByDay={props.itemsByDay}
            selectedDay={props.selectedDay}
            viewYear={props.viewYear}
            viewMonth={props.viewMonth}
            onSelectDay={handleSelectDay}
          />
          <EmptyDayPrimaryAction action={primaryAction} />
        </div>
      </div>
    </div>
  );
}
