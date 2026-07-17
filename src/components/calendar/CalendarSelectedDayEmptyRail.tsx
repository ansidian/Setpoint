import { getCalendarViewMeta } from "./calendarEmptyStateMeta.ts";
import { emptyDayPrimaryAction } from "./calendarOverviewModel.ts";
import {
  EmptyDayCard,
  EmptyDayPrimaryAction,
} from "./CalendarRailPrimitives.tsx";
import { railContentStyle, railStaticStyle } from "./calendarRailStyles.ts";
import { NearbyActivityCard } from "./NearbyActivityCard.tsx";
import type { EmptyDayActionOptions, ItemsByDay, NeighborActiveView } from "./calendarOverviewModel.ts";

interface SelectedDayEmptyProps extends EmptyDayActionOptions {
  selectedDay?: number | null;
  activeView?: NeighborActiveView | null;
  itemsByDay: ItemsByDay;
  setDeadlineEditor?: (value: null) => void;
  setSelectedItemId?: (value: null) => void;
  setSelectedDay?: (day: number) => void;
  [key: string]: unknown;
}

export function CalendarSelectedDayEmptyRail(props: SelectedDayEmptyProps) {
  const primaryAction = emptyDayPrimaryAction(props);
  const model = getCalendarViewMeta(props.view);
  const handleSelectDay = (day: number) => {
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
            selectedDay={props.selectedDay ?? 1}
            compact
          />

          <NearbyActivityCard
            model={model}
            activeView={props.activeView}
            itemsByDay={props.itemsByDay}
            selectedDay={props.selectedDay ?? 1}
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
