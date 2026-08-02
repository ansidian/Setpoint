import { consumeAnthropicStream } from "./anthropic-stream.ts";
import { ALFRED_TOOL_DEFINITIONS } from "./alfred-tools.ts";
import type {
  AlfredConversation,
  AlfredModelAdapter,
  AlfredProviderToolResult,
  AlfredProviderTurn,
  AnthropicContentBlock,
  AnthropicMessage,
  AnthropicToolResultBlock,
  RunAlfredProviderTurnOptions,
} from "./alfred-types.ts";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const MAX_OUTPUT_TOKENS = 2000;

function messages(conversation: AlfredConversation): AnthropicMessage[] {
  return conversation.messages as AnthropicMessage[];
}

function withCacheBreakpoint(input: AnthropicMessage[]): AnthropicMessage[] {
  const last = input.at(-1);
  if (!last) return input;
  const blocks: AnthropicContentBlock[] = typeof last.content === "string"
    ? [{ type: "text", text: last.content }]
    : last.content.map((block) => ({ ...block }));
  const finalBlock = blocks.at(-1);
  if (!finalBlock) return input;
  blocks[blocks.length - 1] = { ...finalBlock, cache_control: { type: "ephemeral" } };
  return [...input.slice(0, -1), { ...last, content: blocks }];
}

function appendUserText(conversation: AlfredConversation, text: string): void {
  messages(conversation).push({ role: "user", content: text });
}

async function runTurn({
  conversation,
  system,
  apiKey,
  forceTool = null,
  signal = null,
  fetchImpl,
  onTextDelta,
}: RunAlfredProviderTurnOptions): Promise<AlfredProviderTurn> {
  const body: Record<string, unknown> = {
    model: conversation.model,
    max_tokens: MAX_OUTPUT_TOKENS,
    stream: true,
    system,
    tools: ALFRED_TOOL_DEFINITIONS,
    messages: withCacheBreakpoint(messages(conversation)),
  };
  if (forceTool) body.tool_choice = { type: "tool", name: forceTool };

  const response = await fetchImpl(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": ANTHROPIC_VERSION,
    },
    body: JSON.stringify(body),
    ...(signal ? { signal } : {}),
  });
  if (!response.ok) {
    await response.text().catch(() => "");
    throw Object.assign(new Error(`Anthropic API error (${response.status})`), {
      status: response.status,
    });
  }
  if (!response.body) throw new Error("Anthropic response stream was empty");

  const turn = await consumeAnthropicStream(response.body, { onTextDelta });
  return {
    model: turn.model,
    stopReason: turn.stopReason,
    toolCalls: turn.content
      .filter((block) => block.type === "tool_use")
      .map((block) => ({ id: block.id, name: block.name, input: block.input })),
    usage: turn.usage,
    providerState: turn.content,
  };
}

function appendAssistantTurn(conversation: AlfredConversation, turn: AlfredProviderTurn): void {
  messages(conversation).push({
    role: "assistant",
    content: turn.providerState as AnthropicContentBlock[],
  });
}

function appendToolResults(conversation: AlfredConversation, results: AlfredProviderToolResult[]): void {
  const blocks: AnthropicToolResultBlock[] = results.map(({ toolId, result }) => ({
    type: "tool_result",
    tool_use_id: toolId,
    content: JSON.stringify(result),
    ...(result.error ? { is_error: true as const } : {}),
  }));
  messages(conversation).push({ role: "user", content: blocks });
}

export const anthropicAlfredAdapter: AlfredModelAdapter = {
  appendUserText,
  runTurn,
  appendAssistantTurn,
  appendToolResults,
};
