import { fetchWithTimeout } from "../../platform/fetch-with-timeout.ts";
import { resolveAiApiKey } from "../../ai-credentials.ts";
import type { BillCandidate, BillExtractionProvider, BillExtractionRequest } from "../../../shared/types/bills.ts";

type HttpError = Error & { status?: number };
interface AnthropicResponse {
  content?: Array<{ type?: string; name?: string; input?: BillCandidate }>;
  usage?: Record<string, unknown>;
}

// LLM completions legitimately run long; this deadline is a wedge-breaker
// (guards against a hung connection), not a latency budget.
const BILL_EXTRACT_TIMEOUT_MS = 120_000;

const TOOL = {
  name: "submit_bill",
  description: "Submit extracted bill fields.",
  input_schema: {
    type: "object",
    properties: {
      payee: { type: "string" },
      amount: { type: "number" },
      due_date: { type: "string" },
      type: { type: "string", enum: ["transfer", "bill", "expense", "income"] },
      category_code: { type: ["string", "null"] },
      category_name: { type: ["string", "null"] },
      to_account_code: { type: ["string", "null"] },
    },
    required: ["payee", "amount", "due_date", "type"],
  },
};

export function createAnthropicProvider({
  resolveApiKey = resolveAiApiKey,
}: {
  resolveApiKey?: typeof resolveAiApiKey;
} = {}): BillExtractionProvider & { id: string; envVar: string } {
  return {
  id: "anthropic",
  envVar: "ANTHROPIC_API_KEY",

  async extract({ model, systemPrompt, content }: BillExtractionRequest) {
    const apiKey = await resolveApiKey("anthropic");
    if (!apiKey) {
      const err: HttpError = new Error("ANTHROPIC_API_KEY not set");
      err.status = 503;
      throw err;
    }

    const apiRes = await fetchWithTimeout("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: 300,
        system: systemPrompt,
        tools: [TOOL],
        tool_choice: { type: "tool", name: "submit_bill" },
        messages: [{ role: "user", content }],
      }),
    }, { timeoutMs: BILL_EXTRACT_TIMEOUT_MS });

    if (!apiRes.ok) {
      await apiRes.text();
      console.error(`[EA] Bill extract Anthropic error (${apiRes.status})`);
      const err: HttpError = new Error(`Anthropic API error (${apiRes.status})`);
      err.status = 502;
      throw err;
    }

    const data = await apiRes.json() as AnthropicResponse;
    const toolBlock = (data.content || []).find(
      (c) => c.type === "tool_use" && c.name === "submit_bill",
    );
    if (!toolBlock?.input) {
      console.error("[EA] Bill extract: no tool_use in Anthropic response", data);
      const err: HttpError = new Error("Extraction failed");
      err.status = 502;
      throw err;
    }

    return { fields: toolBlock.input, usage: data.usage || {} };
  },
  };
}

export const ANTHROPIC_PROVIDER = createAnthropicProvider();
