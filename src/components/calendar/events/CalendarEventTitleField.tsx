import { useEffect, type ChangeEventHandler, type KeyboardEventHandler, type RefObject } from "react";
import { FieldLabel, FieldValidationMessage } from "./CalendarEditorControls";
import { textFieldStyle } from "./calendarEditorUtils";

interface CalendarEventTitleFieldProps {
  titleRef: RefObject<HTMLInputElement | null>;
  titleInputRef: RefObject<string>;
  titleInputKey: number;
  onTitleKeyDown: KeyboardEventHandler<HTMLInputElement>;
  onTitleChange: ChangeEventHandler<HTMLInputElement>;
  disabled: boolean;
  isEditing: boolean;
  titleError: string | null;
}

export default function CalendarEventTitleField({
  titleRef,
  titleInputRef,
  titleInputKey,
  onTitleKeyDown,
  onTitleChange,
  disabled,
  isEditing,
  titleError,
}: CalendarEventTitleFieldProps) {
  useEffect(() => {
    if (titleRef.current && titleInputRef?.current != null) {
      titleRef.current.value = titleInputRef.current;
    }
  }, [titleInputKey, titleInputRef, titleRef]);

  const errorId = "calendar-event-title-error";

  return (
    <div>
      <FieldLabel>Title</FieldLabel>
      <input
        ref={titleRef}
        data-testid="calendar-event-title"
        data-calendar-editor-primary="true"
        type="text"
        aria-label="Event title"
        aria-invalid={!!titleError}
        aria-describedby={titleError ? errorId : undefined}
        defaultValue=""
        onKeyDown={onTitleKeyDown}
        onChange={onTitleChange}
        disabled={disabled}
        placeholder={isEditing ? "Event title" : "Dinner on Tue at 5pm"}
        style={textFieldStyle({ invalid: !!titleError })}
      />
      {titleError ? <FieldValidationMessage id={errorId}>{titleError}</FieldValidationMessage> : null}
    </div>
  );
}
