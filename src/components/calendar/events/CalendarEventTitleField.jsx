import { useEffect } from "react";
import { FieldLabel } from "./CalendarEditorControls";
import { textFieldStyle } from "./calendarEditorUtils";

export default function CalendarEventTitleField({
  titleRef,
  titleInputRef,
  titleInputKey,
  onTitleKeyDown,
  onTitleChange,
  disabled,
  isEditing,
  validationMessage,
}) {
  useEffect(() => {
    if (titleRef.current && titleInputRef?.current != null) {
      titleRef.current.value = titleInputRef.current;
    }
  }, [titleInputKey, titleInputRef, titleRef]);

  return (
    <div>
      <FieldLabel>Title</FieldLabel>
      <input
        ref={titleRef}
        data-testid="calendar-event-title"
        data-calendar-editor-primary="true"
        type="text"
        aria-label="Event title"
        defaultValue=""
        onKeyDown={onTitleKeyDown}
        onChange={onTitleChange}
        disabled={disabled}
        placeholder={isEditing ? "Event title" : "Dinner on Tue at 5pm"}
        style={textFieldStyle({ invalid: validationMessage === "Title is required." })}
      />
    </div>
  );
}
