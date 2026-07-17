import { consumeAnthropicStream } from "./anthropic-stream.ts";
import { ALFRED_TOOL_DEFINITIONS, DEFAULT_SEARCH_LIMIT, alfredToolSummary, executeAlfredTool } from "./alfred-tools.ts";
import { buildAlfredSystemPrompt } from "./alfred-prompt.ts";
import { recordAlfredUsage } from "./alfred-usage.ts";
import type { AlfredToolName, AlfredToolResultBase } from "../../shared/types/alfred.ts";
import type {
  AnthropicContentBlock,
  AnthropicMessage,
  AnthropicToolResultBlock,
  RunAlfredOptions,
} from "./alfred-types.ts";
import { errorMessage } from "./alfred-types.ts";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const MAX_TOOL_ITERATIONS = 12;
const MAX_TOKENS = 2000;

// Cite-by-reference backstop (ADR 0006): smaller models sometimes retype item
// details instead of calling show_items. When a run retrieved a small, almost
// certainly named result set and is about to end without rows, remind once.
// Above this size the answer is likely a summary/count, where rows would spam.
// Pinned to one default search page: a lower cap let every default search_email
// call disarm the backstop by itself (C8: 12 retrieved > 8 cap).
const MAX_NUDGE_ITEMS = DEFAULT_SEARCH_LIMIT;
const SHOW_ITEMS_NUDGE = "<system-reminder>Your reply referenced retrieved items without calling show_items. If it named specific emails, events, deadlines, bills, or transactions, call show_items now with those ids, then add at most one short sentence without retyping details the rows show. If it did not name specific items, briefly restate your conclusion.</system-reminder>";

// Second backstop (ADR 0006, alfred-prompt.ts group_items rule): a question that
// asks for a SPLIT across 2+ categories should land as a group_items breakdown
// card, not a prose enumeration. Smaller models (Haiku) skip the tool and narrate
// every item instead — worst when a bucket is defined by absence (e.g. "ghosts" =
// applications with no follow-up). When such a question is about to end in prose
// with no card and no spending summary, remind once.
const GROUP_ITEMS_NUDGE = "<system-reminder>This question asks for a split across categories, but you are about to answer in prose without a breakdown card. Sort the relevant item ids into labeled buckets (choose the labels from the question) and call group_items now, then give a one-line takeaway with the headline numbers. A bucket may be defined by the absence of something (for example, items with no follow-up) — include the ids that qualify.</system-reminder>";

// True when the question asks for a split into 2+ named categories (a "how many X
// … how many Y", or an explicit break-down / group-by / distribution), as opposed
// to a single count ("how many deadlines") or a magnitude ("how much did I spend"),
// which read fine as one line and must NOT trip the card backstop.
const GROUPING_VERB = /\bbreak(?:\s|-)?(?:it|these|them|this|down)\b|\bbreakdown\b|\bgroup(?:ed|ing)?\b|\bsplit\b|\bdistribution\b|\bcategor(?:y|ies|ize|ised|ized)\b|\bby (?:status|sender|month|category|label|merchant|type|priority|day|week|account)\b|\b(?:vs\.?|versus)\b/i;
export function looksLikeGroupingQuestion(text: unknown): boolean {
  const s = String(text || "");
  const howMany = (s.match(/how many\b/gi) || []).length;
  return howMany >= 2 || GROUPING_VERB.test(s);
}

// The cite-by-reference backstop counts items the model can actually name this run.
// Each row-bearing tool returns exactly one array of rows; gate on that length, not
// a tool's `total` — `total` can be a full match count (search_email when paged,
// where the page is small but total large) or a dollar sum (summarize_transactions).
const CITABLE_ROW_KEYS = ["results", "events", "deadlines", "bills", "transactions"];
function citableRowCount(result: AlfredToolResultBase): number {
  for (const key of CITABLE_ROW_KEYS) {
    if (Array.isArray(result?.[key])) return result[key].length;
  }
  return 0;
}

// Multi-turn prompt caching: mark the last block of the last message so the
// cached prefix covers tools + system + the whole transcript. Only the outgoing
// request copy is marked — the stored transcript keeps its plain shapes.
function withCacheBreakpoint(messages: AnthropicMessage[]): AnthropicMessage[] {
  const last = messages.at(-1);
  if (!last) return messages;
  const blocks: AnthropicContentBlock[] = typeof last.content === "string"
    ? [{ type: "text", text: last.content }]
    : last.content.map((block) => ({ ...block }));
  const finalBlock = blocks.at(-1);
  if (!finalBlock) return messages;
  blocks[blocks.length - 1] = { ...finalBlock, cache_control: { type: "ephemeral" } };
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
}: RunAlfredOptions & { transcriptCheckpoint: number }): Promise<void> {
  conversation.messages.push({ role: "user", content: String(message) });
  const system = buildAlfredSystemPrompt({ now: now() });

  let retrievedCount = 0;
  let showItemsCalled = false;
  let groupItemsCalled = false;
  let summarizeCalled = false;
  let nudged = false;
  let nudgedGroup = false;
  let forceGroupItems = false;
  const groupIntent = looksLikeGroupingQuestion(message);

  for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration += 1) {
    const body: Record<string, unknown> = {
      model,
      max_tokens: MAX_TOKENS,
      stream: true,
      system,
      tools: ALFRED_TOOL_DEFINITIONS,
      messages: withCacheBreakpoint(conversation.messages),
    };
    // Deterministic grouping backstop: after the group nudge, pin the breakdown
    // tool for one turn so a split question can't end as prose again when Haiku
    // ignores the soft reminder. tool_choice is request-only (outside the cached
    // prefix), so toggling it per turn doesn't disturb prompt caching. One-shot:
    // reset immediately so the follow-up turn can produce the prose takeaway.
    if (forceGroupItems) body.tool_choice = { type: "tool", name: "group_items" };
    forceGroupItems = false;
    const res = await fetchImpl(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
      },
      body: JSON.stringify(body),
      ...(signal ? { signal } : {}),
    });
    if (!res.ok) {
      const text = await res.text?.().catch(() => "");
      const err = Object.assign(
        new Error(`Anthropic API error (${res.status})${text ? `: ${String(text).slice(0, 300)}` : ""}`),
        { status: res.status },
      );
      throw err;
    }

    if (!res.body) throw new Error("Anthropic response stream was empty");
    const turn = await consumeAnthropicStream(res.body, {
      onTextDelta: (text: string) => emit({ type: "text_delta", text }),
    });

    recordUsage(userId, {
      eventType: "alfred_run_turn",
      model: turn.model || model,
      usage: turn.usage,
      metadata: { iteration, conversation_id: conversation.id },
    }).catch((err) => {
      console.error("[Alfred] usage recording failed:", errorMessage(err, "usage recording failed"));
    });

    conversation.messages.push({ role: "assistant", content: turn.content });

    const toolUses = turn.content.filter((block) => block.type === "tool_use");
    if (turn.stopReason !== "tool_use" || !toolUses.length) {
      // A split/categorize question answered as prose with no card → nudge toward
      // group_items first (the right surface for a multi-bucket answer), ahead of
      // the show_items backstop. Gated on !groupItemsCalled, NOT !showItemsCalled:
      // a prior show_items flat list must not disarm this, or a split answered as
      // "list + prose counts" slips through (the exact Haiku failure). No item cap:
      // the card earns its keep on large sets.
      if (!nudgedGroup && groupIntent && !groupItemsCalled && !summarizeCalled && retrievedCount > 0) {
        nudgedGroup = true;
        forceGroupItems = true;
        conversation.messages.push({ role: "user", content: GROUP_ITEMS_NUDGE });
        continue;
      }
      if (!nudged && !showItemsCalled && !groupItemsCalled && retrievedCount > 0 && retrievedCount <= MAX_NUDGE_ITEMS) {
        nudged = true;
        conversation.messages.push({ role: "user", content: SHOW_ITEMS_NUDGE });
        continue;
      }
      emit({ type: "run_end", stop_reason: turn.stopReason || "end_turn" });
      return;
    }

    const toolResults: AnthropicToolResultBlock[] = [];
    for (const toolUse of toolUses) {
      const toolName = toolUse.name as AlfredToolName;
      emit({ type: "tool_start", tool_id: toolUse.id, name: toolName });
      const toolStartedAt = now().getTime();
      let result;
      try {
        result = await executeAlfredTool(toolName, toolUse.input, {
          userId,
          conversation,
          deps,
          emit,
        });
      } catch (err) {
        result = { error: errorMessage(err) };
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
        console.error("[Alfred] tool usage recording failed:", errorMessage(err, "tool usage recording failed"));
      });
      if (toolName === "show_items") {
        // Only a call that actually rendered rows counts as citing (C7): an errored
        // or zero-shown call used to set this flag and permanently disarm the
        // cite-by-reference backstop while the owner saw nothing.
        if (!result?.error && Number(result?.shown) > 0) showItemsCalled = true;
      } else if (toolName === "group_items") {
        groupItemsCalled = true;
      } else if (toolName === "summarize_transactions") {
        summarizeCalled = true;
      } else if (!result?.error) {
        retrievedCount += citableRowCount(result);
      }
      emit({
        type: "tool_result",
        tool_id: toolUse.id,
        name: toolName,
        ok: !result?.error,
        summary: alfredToolSummary(toolName, result),
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

export async function runAlfred(opts: RunAlfredOptions): Promise<void> {
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
