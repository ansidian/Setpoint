// Parses the Anthropic Messages API SSE stream (stream: true) into final
// content blocks. `body` is any async iterable of Uint8Array or string
// (Node fetch response.body qualifies).
import type { AnthropicTextBlock, AnthropicToolUseBlock, AnthropicTurn } from "./alfred-types.ts";

type BuildingToolUseBlock = AnthropicToolUseBlock & { _json?: string };
type BuildingContentBlock = AnthropicTextBlock | BuildingToolUseBlock;
type AnthropicStreamEvent = {
  type?: string;
  index?: number;
  message?: { model?: string; usage?: Record<string, unknown> };
  content_block?: Record<string, unknown>;
  delta?: Record<string, unknown>;
  usage?: Record<string, unknown>;
  error?: { message?: string; type?: string };
};

export async function consumeAnthropicStream(
  body: AsyncIterable<Uint8Array | string>,
  { onTextDelta }: { onTextDelta?: (text: string) => void } = {},
): Promise<AnthropicTurn> {
  const decoder = new TextDecoder();
  let buffer = "";
  const content: Array<BuildingContentBlock | undefined> = [];
  let stopReason: string | null = null;
  let usage: Record<string, unknown> = {};
  let model: string | null = null;

  const handleEvent = (data: AnthropicStreamEvent): void => {
    if (data.type === "message_start") {
      model = data.message?.model || null;
      usage = { ...(data.message?.usage || {}) };
      return;
    }
    if (data.type === "content_block_start") {
      const block = data.content_block || {};
      const index = Number(data.index);
      if (!Number.isInteger(index) || index < 0) return;
      content[index] = block.type === "tool_use"
        ? { type: "tool_use", id: String(block.id || ""), name: String(block.name || ""), input: {}, _json: "" }
        : { type: "text", text: String(block.text || "") };
      return;
    }
    if (data.type === "content_block_delta") {
      const block = content[Number(data.index)];
      if (!block) return;
      if (data.delta?.type === "text_delta" && block.type === "text") {
        const text = String(data.delta.text || "");
        block.text += text;
        onTextDelta?.(text);
      } else if (data.delta?.type === "input_json_delta" && block.type === "tool_use") {
        block._json = `${block._json || ""}${String(data.delta.partial_json || "")}`;
      }
      return;
    }
    if (data.type === "content_block_stop") {
      const block = content[Number(data.index)];
      if (block?.type === "tool_use") {
        try {
          block.input = block._json ? JSON.parse(block._json) : {};
        } catch {
          block.input = {};
        }
        delete block._json;
      }
      return;
    }
    if (data.type === "message_delta") {
      stopReason = typeof data.delta?.stop_reason === "string" ? data.delta.stop_reason : stopReason;
      usage = { ...usage, ...(data.usage || {}) };
      return;
    }
    if (data.type === "error") {
      const err = Object.assign(new Error(data.error?.message || "Anthropic stream error"), {
        code: data.error?.type || "stream_error",
      });
      throw err;
    }
  };

  const drainBuffer = () => {
    let idx;
    while ((idx = buffer.indexOf("\n\n")) !== -1) {
      const rawBlock = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      const payload = rawBlock
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim())
        .join("");
      if (!payload) continue;
      handleEvent(JSON.parse(payload) as AnthropicStreamEvent);
    }
  };

  for await (const chunk of body) {
    buffer += typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true });
    drainBuffer();
  }

  return {
    content: content.filter((block): block is BuildingContentBlock => Boolean(block)).map((block) => {
      if (block.type === "tool_use") {
        const { _json: _discarded, ...toolUse } = block;
        return toolUse;
      }
      return block;
    }),
    stopReason,
    usage,
    model,
  };
}
