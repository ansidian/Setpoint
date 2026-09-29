import { useState } from "react";
import { useNavigate } from "react-router";
import { requestFinancialEventReview } from "../../api";
import { financialReviewHref } from "../../lib/financialReviewApi";
import type { FinancialEventDismissalRequest } from "../../../shared/types/financial-operations";

export type RecordRequestState = { emailUid: string; mode: "record" | "extract" | null; error: string };

/** Opens an ignored or schedule-covered email in the Finance review form. */
export function useRecordInActual() {
  const navigate = useNavigate();
  const [state, setState] = useState<RecordRequestState>({ emailUid: "", mode: null, error: "" });
  async function record(target: FinancialEventDismissalRequest, extract: boolean) {
    setState({ emailUid: target.emailUid, mode: extract ? "extract" : "record", error: "" });
    let error = "";
    try {
      await requestFinancialEventReview({ emailUid: target.emailUid, documentRevision: target.documentRevision,
        eventRevision: target.eventRevision, extract });
      navigate(financialReviewHref(target.emailUid));
    } catch (cause) {
      const reason = cause instanceof Error ? cause.message : "";
      error = extract ? `Couldn’t extract details${reason ? ` (${reason})` : ""}. Use Record in Actual to enter them yourself.`
        : reason || "Couldn’t open this email for recording.";
    } finally {
      // The reader stays mounted beneath the Finance workspace; closing it must
      // return usable controls rather than a stale busy state.
      setState({ emailUid: target.emailUid, mode: null, error });
    }
  }
  return { state, record };
}
