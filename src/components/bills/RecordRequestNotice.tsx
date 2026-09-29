import type { RecordRequestState } from "./useRecordInActual";

/** Progress and failure for a request started from a menu that closes on selection. */
export default function RecordRequestNotice({ state, emailUid, className = "" }: { state: RecordRequestState; emailUid: string; className?: string }) {
  if (state.emailUid !== emailUid) return null;
  if (state.error) return <p role="alert" className={`text-[11px] leading-relaxed text-[var(--sp-cream)] ${className}`}>{state.error}</p>;
  if (state.mode === "extract") return <p role="status" className={`text-[11px] leading-relaxed text-muted-foreground ${className}`}>Extracting details…</p>;
  return null;
}
