export function getCalendarEditorErrorDetails(error: unknown, fallback: string) {
  if (error && typeof error === "object") {
    const candidate = error as { message?: unknown; code?: unknown };
    return {
      message: typeof candidate.message === "string" && candidate.message ? candidate.message : fallback,
      code: typeof candidate.code === "string" ? candidate.code : null,
    };
  }
  return { message: fallback, code: null };
}
