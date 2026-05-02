import { FieldLabel } from "./CalendarEditorControls";
import { textFieldStyle } from "./calendarEditorUtils";

export default function CalendarEventLocationField({
  locationRef,
  draft,
  disabled,
  setOpenPicker,
  updateField,
  handleLocationSuggestionKey,
  locationSuggestionsError,
}) {
  return (
    <div>
      <FieldLabel>Location</FieldLabel>
      <input
        ref={locationRef}
        data-testid="calendar-event-location"
        type="text"
        aria-label="Event location"
        value={draft.location}
        onFocus={() => {
          if (!disabled) setOpenPicker("location");
        }}
        onChange={(event) => {
          updateField("location", event.target.value);
          if (!disabled) setOpenPicker("location");
        }}
        onKeyDown={async (event) => {
          if (await handleLocationSuggestionKey(event)) return;
          event.stopPropagation();
        }}
        disabled={disabled}
        placeholder="Search places or type location"
        style={textFieldStyle()}
      />
      {!locationSuggestionsError ? (
        <div
          style={{
            marginTop: 6,
            fontSize: 10.5,
            color: "rgba(205,214,244,0.45)",
            lineHeight: 1.45,
          }}
        >
          Suggestions stay biased to your saved weather location.
        </div>
      ) : null}
    </div>
  );
}
