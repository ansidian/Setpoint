import { ALFRED_TOOL_DEFINITIONS } from "./alfred-tools.ts";
import { consumeOpenAiStream } from "./openai-stream.ts";
import type {
  AlfredConversation,
  AlfredModelAdapter,
  AlfredProviderToolResult,
  AlfredProviderTurn,
  RunAlfredProviderTurnOptions,
} from "./alfred-types.ts";

const OPENAI_URL = "https://api.openai.com/v1/responses";
const MAX_OUTPUT_TOKENS = 2000;

function input(conversation: AlfredConversation): Record<string, unknown>[] {
  return conversation.messages as Record<string, unknown>[];
}

function openAiTools() {
  return ALFRED_TOOL_DEFINITIONS.map(({ name, description, input_schema }) => ({
    type: "function",
    name,
    description,
    parameters: input_schema,
  }));
}

function appendUserText(conversation: AlfredConversation, text: string): void {
  input(conversation).push({ role: "user", content: text });
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
    instructions: system,
    input: input(conversation),
    tools: openAiTools(),
    stream: true,
    store: false,
    max_output_tokens: MAX_OUTPUT_TOKENS,
    parallel_tool_calls: true,
    include: ["reasoning.encrypted_content"],
  };
  if (forceTool) body.tool_choice = { type: "function", name: forceTool };

  const response = await fetchImpl(OPENAI_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    ...(signal ? { signal } : {}),
  });
  if (!response.ok) {
    await response.text().catch(() => "");
    throw Object.assign(new Error(`OpenAI API error (${response.status})`), {
      status: response.status,
    });
  }
  if (!response.body) throw new Error("OpenAI response stream was empty");

  const turn = await consumeOpenAiStream(response.body, { onTextDelta });
  return {
    model: turn.model,
    stopReason: turn.stopReason,
    toolCalls: turn.toolCalls,
    usage: turn.usage,
    providerState: turn.output,
  };
}

function appendAssistantTurn(conversation: AlfredConversation, turn: AlfredProviderTurn): void {
  input(conversation).push(...turn.providerState as Record<string, unknown>[]);
}

function appendToolResults(conversation: AlfredConversation, results: AlfredProviderToolResult[]): void {
  input(conversation).push(...results.map(({ toolId, result }) => ({
    type: "function_call_output",
    call_id: toolId,
    output: JSON.stringify(result),
  })));
}

export const openAiAlfredAdapter: AlfredModelAdapter = {
  appendUserText,
  runTurn,
  appendAssistantTurn,
  appendToolResults,
};
