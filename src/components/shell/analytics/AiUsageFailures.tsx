import { ChevronDown, TriangleAlert } from "lucide-react";
import type { AiUsageFailure, AiUsageFailureCode, AiUsageOrigin, AiUsagePurpose } from "../../../../shared/types/ai-usage";

const PURPOSE: Record<AiUsagePurpose, string> = {
  triage_cheap: "Cheap pass", triage_strong: "Strong pass", extraction: "Extraction", verification: "Verification", matching: "Matching",
};
const ORIGIN: Record<AiUsageOrigin, string> = {
  background_triage: "Background triage", reader_adoption: "Email reader", manual_extraction: "Manual extraction", transaction_import: "Transaction import", evaluation: "Evaluation",
};
const FAILURE: Record<AiUsageFailureCode, string> = {
  output_limit: "Output limit reached", content_filter: "Response filtered or refused", invalid_json: "Invalid JSON",
  invalid_response: "Unusable response", http_error: "Provider HTTP error", timeout: "Request timed out", transport_error: "Request failed",
};

const number = (value: number | null | undefined) => value == null ? "Unknown" : value.toLocaleString();

function FailureDetails({ failure }: { failure: AiUsageFailure }) {
  const d = failure.diagnostics;
  const fields = [
    ["HTTP status", number(failure.httpStatus)],
    ["Provider time", (failure.providerLatencyMs / 1000).toFixed(2) + " s"],
    ["Input tokens", number(failure.inputTokens)],
    ["Output / limit", `${number(failure.outputTokens)} / ${number(d?.maxOutputTokens)}`],
    ["Reasoning tokens", number(d?.reasoningTokens)],
    ["Response status", d?.responseStatus ?? "Not reported"],
    ["Stop reason", d?.stopReason ?? "Not reported"],
    ["Failure stage", failure.outcome === "parse_error" ? "Response parsing" : "Request or response envelope"],
  ];
  return (
    <div className="space-y-3 pb-3 pt-1 text-[11px]">
      {!d && <p className="text-muted-foreground">Additional diagnostics were not recorded for this call.</p>}
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 tabular-nums sm:grid-cols-4">
        {fields.map(([label, value]) => <div key={label} className="min-w-0"><dt className="text-muted-foreground">{label}</dt><dd className="mt-0.5 break-words text-foreground">{value}</dd></div>)}
      </dl>
      <dl className="space-y-1 border-t border-white/[0.06] pt-2 text-muted-foreground">
        <div><dt className="inline">Call ID: </dt><dd className="inline break-all select-text">{failure.eventId}</dd></div>
        <div><dt className="inline">Run ID: </dt><dd className="inline break-all select-text">{failure.runId}</dd></div>
      </dl>
    </div>
  );
}

export default function AiUsageFailures({ failures, total }: { failures: AiUsageFailure[]; total: number }) {
  if (!total) return null;
  return (
    <section aria-label="Recent failures" className="rounded-lg border border-white/[0.06] bg-black/[0.10] p-3">
      <h3 className="flex items-center gap-2 text-[11px] font-semibold tracking-[1.4px] text-foreground uppercase"><TriangleAlert size={13} className="text-[var(--sp-rose)]" />Recent failures</h3>
      <p className="mb-1 mt-1 text-[11px] text-muted-foreground">{failures.length < total ? `Latest ${failures.length} of ${total} failed calls in this window.` : "Failed calls in this window."} Expand a call for diagnostics.</p>
      {failures.map((failure) => (
        <details key={failure.eventId} className="group border-t border-white/[0.06]">
          <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-md py-2 text-[11px] transition-[background-color,transform] duration-150 hover:bg-white/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 motion-safe:hover:translate-x-px motion-safe:focus-visible:translate-x-px active:scale-[0.99] motion-reduce:transform-none motion-reduce:transition-none [&::-webkit-details-marker]:hidden">
            <ChevronDown size={12} className="shrink-0 text-muted-foreground transition-transform group-open:rotate-180 motion-reduce:transition-none" />
            <span className="min-w-0 flex-1 space-y-1">
              <span className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <span className="font-medium text-foreground">{PURPOSE[failure.purpose]} · {failure.diagnostics?.failureCode ? FAILURE[failure.diagnostics.failureCode] : failure.outcome === "parse_error" ? "Response parsing failed" : "Provider request failed"}</span>
                <time dateTime={failure.startedAt} className="text-muted-foreground">{new Date(failure.startedAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" })}</time>
              </span>
              <span className="block break-words text-muted-foreground">{failure.provider === "openai" ? "OpenAI" : "Anthropic"} · {failure.model} · {ORIGIN[failure.origin]}</span>
            </span>
          </summary>
          <FailureDetails failure={failure} />
        </details>
      ))}
    </section>
  );
}
