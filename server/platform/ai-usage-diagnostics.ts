import type { AiUsageDiagnostics, AiUsageFailureCode } from "../../shared/types/ai-usage.ts";

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" ? value as Record<string, unknown> : {};
}
function count(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}
function allowed(value: unknown, values: string[]): string | null {
  return typeof value === "string" && values.includes(value) ? value : null;
}

// Only fixed provider enums and numeric measurements cross this boundary.
// Never retain error messages, tool arguments, refusal text or arbitrary metadata.
export function captureAiUsageDiagnostics(provider: "openai" | "anthropic", response: unknown, maxOutputTokens?: number): AiUsageDiagnostics {
  const source = record(response);
  return {
    responseStatus: provider === "openai"
      ? allowed(source.status, ["completed", "incomplete", "failed", "cancelled", "queued", "in_progress"]) : null,
    stopReason: provider === "openai"
      ? allowed(record(source.incomplete_details).reason, ["max_output_tokens", "content_filter"])
      : allowed(source.stop_reason, ["end_turn", "max_tokens", "stop_sequence", "tool_use", "pause_turn", "refusal", "model_context_window_exceeded"]),
    maxOutputTokens: count(maxOutputTokens),
    reasoningTokens: provider === "openai" ? count(record(record(source.usage).output_tokens_details).reasoning_tokens) : null,
    failureCode: null,
  };
}

export function classifyAiUsageFailure(error: unknown, hadResponse: boolean, httpStatus: number | null, diagnostics: AiUsageDiagnostics): AiUsageFailureCode {
  if (diagnostics.stopReason === "max_output_tokens" || diagnostics.stopReason === "max_tokens") return "output_limit";
  if (diagnostics.stopReason === "content_filter" || diagnostics.stopReason === "refusal") return "content_filter";
  if (httpStatus !== null && httpStatus >= 400) return "http_error";
  if (error instanceof Error && (error.name === "TimeoutError" || /^fetch timeout after \d+ms:/.test(error.message))) return "timeout";
  if (error instanceof SyntaxError) return "invalid_json";
  return hadResponse ? "invalid_response" : "transport_error";
}
