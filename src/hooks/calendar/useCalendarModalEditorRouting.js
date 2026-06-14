// Backward-compatible surface for the floating editor routing hook. The
// implementation now lives in useFloatingEditorRouting.js, which also owns the
// deadline editor's own state (EAD-319 / D-CAL-5). Existing importers of this
// path keep working via these re-exports.
import useFloatingEditorRouting, {
  resolveFloatingDeadlineItemId,
  resolveFloatingEventItemId,
} from "./useFloatingEditorRouting.js";

export { resolveFloatingDeadlineItemId, resolveFloatingEventItemId };
export default useFloatingEditorRouting;
