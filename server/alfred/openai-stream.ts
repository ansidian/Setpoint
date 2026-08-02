import type { OpenAiTurn } from "./alfred-types.ts";

type OpenAiStreamEvent = {
  type?: string;
  delta?: string;
  response?: Record<string, unknown>;
  error?: { message?: string; code?: string };
};

function objectArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item))
    : [];
}

function parseInput(value: unknown): Record<string, unknown> {
  if (typeof value !== "string" || !value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function normalizedUsage(value: unknown): Record<string, unknown> {
  const usage = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const details = usage.input_tokens_details && typeof usage.input_tokens_details === "object"
    ? usage.input_tokens_details as Record<string, unknown>
    : {};
  return {
    input_tokens: Number(usage.input_tokens || 0),
    cache_read_input_tokens: Number(details.cached_tokens || 0),
    cache_creation_input_tokens: Number(details.cache_write_tokens || 0),
    output_tokens: Number(usage.output_tokens || 0),
  };
}

export async function consumeOpenAiStream(
  body: AsyncIterable<Uint8Array | string>,
  { onTextDelta }: { onTextDelta?: (text: string) => void } = {},
): Promise<OpenAiTurn> {
  const decoder = new TextDecoder();
  let buffer = "";
  let completed: Record<string, unknown> | null = null;

  const handleEvent = (event: OpenAiStreamEvent): void => {
    if (event.type === "response.output_text.delta") {
      onTextDelta?.(String(event.delta || ""));
      return;
    }
    if (event.type === "response.completed") {
      completed = event.response || null;
      return;
    }
    if (event.type === "response.failed" || event.type === "error") {
      const responseError = event.response?.error && typeof event.response.error === "object"
        ? event.response.error as Record<string, unknown>
        : null;
      throw Object.assign(
        new Error(event.error?.message || String(responseError?.message || "OpenAI stream error")),
        { code: event.error?.code || responseError?.code || "stream_error" },
      );
    }
  };

  const drain = (): void => {
    let boundary = buffer.indexOf("\n\n");
    while (boundary !== -1) {
      const block = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const payload = block
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim())
        .join("");
      if (payload && payload !== "[DONE]") handleEvent(JSON.parse(payload) as OpenAiStreamEvent);
      boundary = buffer.indexOf("\n\n");
    }
  };

  for await (const chunk of body) {
    buffer += typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true });
    drain();
  }
  if (!completed) throw new Error("OpenAI response stream ended before completion");

  const response = completed as Record<string, unknown>;
  const output = objectArray(response.output);
  const toolCalls = output
    .filter((item) => item.type === "function_call")
    .map((item) => ({
      id: String(item.call_id || item.id || ""),
      name: String(item.name || ""),
      input: parseInput(item.arguments),
    }));
  return {
    output,
    stopReason: toolCalls.length ? "tool_use" : String(response.status || "completed"),
    usage: normalizedUsage(response.usage),
    model: typeof response.model === "string" ? response.model : null,
    toolCalls,
  };
}
