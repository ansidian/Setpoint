// Parses the Anthropic Messages API SSE stream (stream: true) into final
// content blocks. `body` is any async iterable of Uint8Array or string
// (Node fetch response.body qualifies).
export async function consumeAnthropicStream(body, { onTextDelta } = {}) {
  const decoder = new TextDecoder();
  let buffer = "";
  const content = [];
  let stopReason = null;
  let usage = {};
  let model = null;

  const handleEvent = (data) => {
    if (data.type === "message_start") {
      model = data.message?.model || null;
      usage = { ...(data.message?.usage || {}) };
      return;
    }
    if (data.type === "content_block_start") {
      const block = data.content_block || {};
      content[data.index] = block.type === "tool_use"
        ? { type: "tool_use", id: block.id, name: block.name, input: {}, _json: "" }
        : { type: "text", text: block.text || "" };
      return;
    }
    if (data.type === "content_block_delta") {
      const block = content[data.index];
      if (!block) return;
      if (data.delta?.type === "text_delta") {
        block.text += data.delta.text;
        onTextDelta?.(data.delta.text);
      } else if (data.delta?.type === "input_json_delta") {
        block._json += data.delta.partial_json;
      }
      return;
    }
    if (data.type === "content_block_stop") {
      const block = content[data.index];
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
      stopReason = data.delta?.stop_reason || stopReason;
      usage = { ...usage, ...(data.usage || {}) };
      return;
    }
    if (data.type === "error") {
      const err = new Error(data.error?.message || "Anthropic stream error");
      err.code = data.error?.type || "stream_error";
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
      handleEvent(JSON.parse(payload));
    }
  };

  for await (const chunk of body) {
    buffer += typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true });
    drainBuffer();
  }

  return { content: content.filter(Boolean), stopReason, usage, model };
}
