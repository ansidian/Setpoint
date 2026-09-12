// Tool failures cross both the owner-visible SSE stream and the durable usage
// ledger. Classify them without copying provider bodies, queries, email ids or
// arbitrary Error.message/code values into either surface.
export interface AlfredToolFailure {
  code: string;
  message: string;
  stage: "validation" | "execution";
  status?: number;
}

export function describeAlfredToolFailure(error: unknown): AlfredToolFailure {
  const details = error && typeof error === "object" ? error as Record<string, unknown> : {};
  const message = typeof error === "string" ? error : String(details.message || "");
  const statusValue = Number(details.status ?? details.statusCode);
  const status = Number.isInteger(statusValue) && statusValue >= 400 && statusValue <= 599 ? statusValue : undefined;
  const failure = (code: string, explanation: string, stage: AlfredToolFailure["stage"] = "execution"): AlfredToolFailure => ({
    code, message: explanation, stage, ...(status ? { status } : {}),
  });

  if (message === "query is required") {
    return failure("missing_query", "Search terms are missing. Alfred can retry with a search query.", "validation");
  }
  if (details.code === "unsupported_email_search_flag" || message.startsWith("Unsupported email search flag:")) {
    return failure("unsupported_email_search_flag", "Unsupported search filter. Alfred can retry with keywords and the available filters.", "validation");
  }
  if (details.code === "invalid_email_search_flags" || message.startsWith("Conflicting email search flags:")) {
    return failure("invalid_email_search_flags", "The search filters conflict. Alfred can retry with one read-state filter.", "validation");
  }
  if (message === "uid is required" || message === "ids is required") {
    return failure("missing_item_reference", "The item reference is missing. Alfred needs to use an item from the search results.", "validation");
  }
  if (message === "start and end must be YYYY-MM-DD dates" || message.startsWith("invalid date range:") || message === "Invalid time value") {
    return failure("invalid_date_range", "The date range is invalid. Alfred can retry with valid start and end dates.", "validation");
  }
  if (message.startsWith("No email found for uid ") || /^No cached \w+ items match these ids;/.test(message)) {
    return failure("item_not_found", "The message or item is no longer available. Search again for a current result.");
  }
  if (status === 401 || status === 403) {
    return failure("access_denied", "Access was denied. Check the connection in Settings.");
  }
  if (status === 404) return failure("not_found", "The requested item could not be found. Search again for a current result.");
  if (status === 429) return failure("rate_limited", "Too many requests. Try again shortly.");
  if (status === 408 || status === 504 || details.name === "TimeoutError" || details.code === "ETIMEDOUT") {
    return failure("timeout", "The request timed out. Try again.");
  }
  if (status && status >= 500) return failure("service_unavailable", "The service is temporarily unavailable. Try again shortly.");
  const cause = details.cause && typeof details.cause === "object" ? details.cause as Record<string, unknown> : {};
  if ([details.code, cause.code].some((code) => ["ECONNRESET", "ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN"].includes(String(code)))) {
    return failure("connection_failed", "The service could not be reached. Try again.");
  }
  if (status === 400 || status === 422) return failure("invalid_request", "The request was rejected. Alfred can revise it and retry.", "validation");
  return failure("tool_failed", "The request failed without an identified cause. Try again.");
}
