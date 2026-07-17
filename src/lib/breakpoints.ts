// Single source of truth for the app's mobile gate.
// Stored as the INCLUSIVE max-width (639) so the query is byte-identical to the
// prior hardcoded literal — NOT a 640 that needs a -1 (which would be an
// off-by-one trap). The calendar's window.innerWidth ladder is a SEPARATE,
// desktop-only mechanism and intentionally does not converge here.
export const MOBILE_MAX_WIDTH = 639;
export const MOBILE_MEDIA_QUERY = `(max-width: ${MOBILE_MAX_WIDTH}px)`;
