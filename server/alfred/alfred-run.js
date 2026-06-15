import { consumeAnthropicStream } from "./anthropic-stream.js";
import { ALFRED_TOOL_DEFINITIONS, alfredToolSummary, executeAlfredTool } from "./alfred-tools.js";
import { buildAlfredSystemPrompt } from "./alfred-prompt.js";
import { recordAlfredUsage } from "./alfred-usage.js";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const MAX_TOOL_ITERATIONS = 12;
const MAX_TOKENS = 2000;

// Cite-by-reference backstop (ADR 0006): smaller models sometimes retype item
// details instead of calling show_items. When a run retrieved a small, almost
// certainly named result set and is about to end without rows, remind once.
// Above this size the answer is likely a summary/count, where rows would spam.
const MAX_NUDGE_ITEMS = 8;
const SHOW_ITEMS_NUDGE = "<system-reminder>Your reply referenced retrieved items without calling show_items. If it named specific emails, events, deadlines, bills, or transactions, call show_items now with those ids, then add at most one short sentence without retyping details the rows show. If it did not name specific items, briefly restate your conclusion.</system-reminder>";

// The cite-by-reference backstop counts items the model can actually name this run.
// Each row-bearing tool returns exactly one array of rows; gate on that length, not
// a tool's `total` — `total` can be a full match count (search_email when paged,
// where the page is small but total large) or a dollar sum (summarize_transactions).
const CITABLE_ROW_KEYS = ["results", "events", "deadlines", "bills", "transactions"];
function citableRowCount(result) {
  for (const key of CITABLE_ROW_KEYS) {
    if (Array.isArray(result?.[key])) return result[key].length;
  }
  return 0;
}

// Multi-turn prompt caching: mark the last block of the last message so the
// cached prefix covers tools + system + the whole transcript. Only the outgoing
// request copy is marked — the stored transcript keeps its plain shapes.
function withCacheBreakpoint(messages) {
  const last = messages.at(-1);
  const blocks = typeof last.content === "string"
    ? [{ type: "text", text: last.content }]
    : last.content.map((block) => ({ ...block }));
  blocks[blocks.length - 1] = { ...blocks.at(-1), cache_control: { type: "ephemeral" } };
  return [...messages.slice(0, -1), { ...last, content: blocks }];
}

async function runAlfredInner({
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
  transcriptCheckpoint = 0,
}) {
  conversation.messages.push({ role: "user", content: String(message) });
  const system = buildAlfredSystemPrompt({ now: now() });

  let retrievedCount = 0;
  let showItemsCalled = false;
  let nudged = false;

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
        messages: withCacheBreakpoint(conversation.messages),
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
      if (!nudged && !showItemsCalled && retrievedCount > 0 && retrievedCount <= MAX_NUDGE_ITEMS) {
        nudged = true;
        conversation.messages.push({ role: "user", content: SHOW_ITEMS_NUDGE });
        continue;
      }
      emit({ type: "run_end", stop_reason: turn.stopReason || "end_turn" });
      return;
    }

    const toolResults = [];
    for (const toolUse of toolUses) {
      emit({ type: "tool_start", tool_id: toolUse.id, name: toolUse.name });
      const toolStartedAt = now().getTime();
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
      recordUsage(userId, {
        eventType: "alfred_tool_call",
        model: turn.model || model,
        usage: {},
        metadata: {
          tool: toolUse.name,
          ok: !result?.error,
          duration_ms: Math.max(0, now().getTime() - toolStartedAt),
          conversation_id: conversation.id,
        },
      }).catch((err) => {
        console.error("[Alfred] tool usage recording failed:", err.message);
      });
      if (toolUse.name === "show_items" || toolUse.name === "group_items") {
        showItemsCalled = true;
      } else if (!result?.error) {
        retrievedCount += citableRowCount(result);
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

  // Tool-call limit reached: revert so the conversation doesn't end on a dangling
  // tool_result user turn (which would 400 on the next reuse).
  conversation.messages.length = transcriptCheckpoint;
  emit({
    type: "run_error",
    message: "Alfred hit the tool-call limit before finishing. Try a narrower question.",
  });
}

export async function runAlfred(opts) {
  const transcriptCheckpoint = opts.conversation.messages.length;
  try {
    return await runAlfredInner({ ...opts, transcriptCheckpoint });
  } catch (err) {
    // A mid-run failure (overload/network/abort) leaves the transcript ending on
    // a user turn; revert to the pre-run boundary so the conversation stays usable.
    opts.conversation.messages.length = transcriptCheckpoint;
    throw err;
  }
}
