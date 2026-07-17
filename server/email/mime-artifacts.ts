// Heuristic detector for index rows whose body_text is raw undecoded MIME
// (audit D1: iCloud rows indexed before the simpleParser fix). Tuned for the
// three artifact classes measured in prod: undecoded quoted-printable,
// leaked MIME structural headers/boundaries, and raw base64 part bodies.
const QP_ESCAPE = /=(?:3D|E2|C2|A0|80|20|0A|0D|09)|=\r?\n/g;
const MIME_HEADER = /Content-(?:Type|Transfer-Encoding|Disposition):/i;
const BOUNDARY_MARKER = /--[A-Za-z0-9'()+_,\-./:=?]{8,}(?:--)?(?:\s|$)/;
const BASE64_RUN = /[A-Za-z0-9+/]{160,}={0,2}/;

export function looksLikeRawMime(bodyText: unknown): boolean {
  const text = String(bodyText || "");
  if (!text) return false;
  if (MIME_HEADER.test(text)) return true;
  if (BASE64_RUN.test(text)) return true;
  const qpHits = text.match(QP_ESCAPE);
  if (qpHits && qpHits.length >= 3) return true;
  return BOUNDARY_MARKER.test(text) && /boundary|multipart|Apple-Mail|=_/i.test(text);
}
