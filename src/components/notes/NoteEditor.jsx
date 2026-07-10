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
  submitOnEnter = false,
  editorApiRef,
  ariaLabel = "Note",
}) {
  const hostRef = useRef(null);
  const viewRef = useRef(null);
  const onBlurRef = useRef();
  onBlurRef.current = onBlur;
  // True only while the effect cleanup is tearing the view down. CM's
  // `view.destroy()` blurs the focused editor, and under StrictMode the mount
  // effect runs mount->cleanup->mount — so that teardown blur fires on a
  // freshly-focused editor. Routing it to onBlur made inline edit commit+close
  // instantly ("editing auto-cancels"); it also turned Escape-to-cancel into a
  // commit. Guard the blur handler so only genuine user blur (click away) commits.
  const destroyingRef = useRef(false);
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
    destroyingRef.current = false; // reset: refs persist across StrictMode's simulated remount
    const view = new EditorView({
      state: EditorState.create({
        doc: value,
        extensions: [
          buildNoteEditorExtensions({ callbacksRef: cbRef, placeholderText: placeholder }),
          EditorView.contentAttributes.of({ "aria-label": ariaLabel }),
          EditorView.domEventHandlers({ blur: () => {
            if (destroyingRef.current) return false; // ignore the blur emitted by view.destroy()
            onBlurRef.current?.(viewRef.current?.state.doc.toString() ?? "");
            return false;
          } }),
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
    return () => { destroyingRef.current = true; view.destroy(); viewRef.current = null; };
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
