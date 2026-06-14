import { consumeAnthropicStream } from "./anthropic-stream.js";
import { ALFRED_TOOL_DEFINITIONS, alfredToolSummary, executeAlfredTool } from "./alfred-tools.js";
import { buildAlfredSystemPrompt } from "./alfred-prompt.js";
import { recordAlfredUsage } from "./alfred-usage.js";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const MAX_TOOL_ITERATIONS = 12;
const MAX_TOKENS = 2000;

export async function runAlfred({
  userId,
  conversation,
  message,
  model,
  emit,
  signal = null,
  fetchImpl = globalThis.fetch,
  apiKey = process.env.ANTHROPIC_API_KEY,
  deps,
  recordUsage = recordAlfredUsage,
  now = () => new Date(),
}) {
  conversation.messages.push({ role: "user", content: String(message) });
  const system = buildAlfredSystemPrompt({ now: now() });

  for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration += 1) {
    const res = await fetchImpl(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model,
        max_tokens: MAX_TOKENS,
        stream: true,
        system,
        tools: ALFRED_TOOL_DEFINITIONS,
        messages: conversation.messages,
      }),
      ...(signal ? { signal } : {}),
    });
    if (!res.ok) {
      const text = await res.text?.().catch(() => "");
      const err = new Error(`Anthropic API error (${res.status})${text ? `: ${String(text).slice(0, 300)}` : ""}`);
      err.status = res.status;
      throw err;
    }

    const turn = await consumeAnthropicStream(res.body, {
      onTextDelta: (text) => emit({ type: "text_delta", text }),
    });

    recordUsage(userId, {
      eventType: "alfred_run_turn",
      model: turn.model || model,
      usage: turn.usage,
      metadata: { iteration, conversation_id: conversation.id },
    }).catch((err) => {
      console.error("[Alfred] usage recording failed:", err.message);
    });

    conversation.messages.push({ role: "assistant", content: turn.content });

    const toolUses = turn.content.filter((block) => block.type === "tool_use");
    if (turn.stopReason !== "tool_use" || !toolUses.length) {
      emit({ type: "run_end", stop_reason: turn.stopReason || "end_turn" });
      return;
    }

    const toolResults = [];
    for (const toolUse of toolUses) {
      emit({ type: "tool_start", tool_id: toolUse.id, name: toolUse.name });
      let result;
      try {
        result = await executeAlfredTool(toolUse.name, toolUse.input, {
          userId,
          conversation,
          deps,
          emit,
        });
      } catch (err) {
        result = { error: err?.message || "tool failed" };
      }
      emit({
        type: "tool_result",
        tool_id: toolUse.id,
        name: toolUse.name,
        ok: !result?.error,
        summary: alfredToolSummary(toolUse.name, result),
      });
      toolResults.push({
        type: "tool_result",
        tool_use_id: toolUse.id,
        content: JSON.stringify(result),
        ...(result?.error ? { is_error: true } : {}),
      });
    }
    conversation.messages.push({ role: "user", content: toolResults });
  }

  emit({
    type: "run_error",
    message: "Alfred hit the tool-call limit before finishing. Try a narrower question.",
  });
}
