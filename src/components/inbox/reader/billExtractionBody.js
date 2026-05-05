export function resolveBillExtractionBody(bodyState) {
  if (!bodyState) {
    return { body: "", loading: false, source: "unavailable", error: null };
  }
  if (bodyState.loading) {
    return { body: "", loading: true, source: "loading", error: null };
  }
  if (bodyState.error) {
    return { body: "", loading: false, source: "error", error: bodyState.error };
  }
  if (bodyState.source === "fallback") {
    return { body: "", loading: false, source: "fallback", error: null };
  }
  return {
    body: bodyState.body || "",
    loading: false,
    source: bodyState.body ? "loaded" : "empty",
    error: null,
  };
}
