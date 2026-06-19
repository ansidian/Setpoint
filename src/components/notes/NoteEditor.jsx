import { useEffect, useRef } from "react";
import { EditorView } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { buildNoteEditorExtensions } from "./noteEditorExtensions.js";

export default function NoteEditor({
  value = "",
  onChange,
  onSubmit,
  onCancel,
  onBlur,
  tags = [],
  autoFocus = false,
  placeholder = "",
  maxHeight = 180,
  submitOnEnter = false,
  editorApiRef,
}) {
  const hostRef = useRef(null);
  const viewRef = useRef(null);
  const onBlurRef = useRef();
  onBlurRef.current = onBlur;
  // The last doc CM emitted. Lets the value-sync effect tell a genuine external
  // change (clear after submit, rollback) apart from CM echoing its own edit
  // back through onChange — so it never re-dispatches mid-type and jumps the cursor.
  const lastEmittedRef = useRef(value);
  // Latest callbacks/inputs read imperatively from inside CM extensions.
  const cbRef = useRef({});
  cbRef.current = {
    onChange: (v) => { lastEmittedRef.current = v; onChange?.(v); },
    onSubmit,
    onCancel,
    submitOnEnter,
    getTags: () => tags,
  };

  useEffect(() => {
    const view = new EditorView({
      state: EditorState.create({
        doc: value,
        extensions: [
          buildNoteEditorExtensions({ callbacksRef: cbRef, placeholderText: placeholder, maxHeight }),
          EditorView.domEventHandlers({ blur: () => { onBlurRef.current?.(viewRef.current?.state.doc.toString() ?? ""); return false; } }),
        ],
      }),
      parent: hostRef.current,
    });
    viewRef.current = view;
    if (autoFocus) view.focus();
    if (editorApiRef) {
      editorApiRef.current = {
        focus: () => view.focus(),
        getValue: () => view.state.doc.toString(),
        submit: () => cbRef.current.onSubmit?.(view.state.doc.toString()),
      };
    }
    return () => { view.destroy(); viewRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync external value → editor (e.g. cleared after submit) without clobbering
  // typing: skip when `value` only echoes CM's own last emission.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const cur = view.state.doc.toString();
    if (value !== cur && value !== lastEmittedRef.current) {
      view.dispatch({ changes: { from: 0, to: cur.length, insert: value } });
    }
  }, [value]);

  return <div ref={hostRef} data-testid="note-editor" style={{ width: "100%" }} />;
}
