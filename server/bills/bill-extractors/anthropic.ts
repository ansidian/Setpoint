import { fetchWithTimeout } from "../../platform/fetch-with-timeout.ts";
import { resolveAiApiKey } from "../../ai-credentials.ts";
import type { BillCandidate, BillExtractionProvider, BillExtractionRequest } from "../../../shared/types/bills.ts";
import { BILL_AMOUNT_KINDS, BILL_EVENT_KINDS } from "../../../shared/types/bills.ts";

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
      amount: { type: ["number", "null"] },
      amount_kind: { type: ["string", "null"], enum: [...BILL_AMOUNT_KINDS, null] },
      amount_candidates: {
        type: "array",
        maxItems: 8,
        items: {
          type: "object",
          properties: {
            kind: { type: "string", enum: BILL_AMOUNT_KINDS },
            value: { type: "number" },
            evidence: { type: ["string", "null"] },
            confidence: { type: ["number", "null"] },
          },
          required: ["kind", "value", "evidence", "confidence"],
        },
      },
      event_kind: { type: "string", enum: BILL_EVENT_KINDS },
      event_confidence: { type: "number" },
      event_evidence: { type: "string" },
      account_last4: { type: ["string", "null"], pattern: "^[0-9]{4}$" },
      account_last4_evidence: { type: ["string", "null"] },
      account_last4_confidence: { type: ["number", "null"], minimum: 0, maximum: 1 },
      target_policy_key: { type: ["string", "null"] },
      target_confidence: { type: ["number", "null"], minimum: 0, maximum: 1 },
      target_evidence: { type: ["string", "null"] },
      due_date: { type: ["string", "null"] },
      currency: { type: ["string", "null"] },
      type: { type: "string", enum: ["transfer", "bill", "expense", "income"] },
      category_code: { type: ["string", "null"] },
      category_name: { type: ["string", "null"] },
      to_account_code: { type: ["string", "null"] },
    },
    required: ["payee", "amount", "amount_kind", "amount_candidates", "event_kind", "event_confidence", "event_evidence", "account_last4", "account_last4_evidence", "account_last4_confidence", "target_policy_key", "target_confidence", "target_evidence", "due_date", "currency", "type"],
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
        max_tokens: 800,
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
      console.error("[EA] Bill extract: no tool_use in Anthropic response");
      const err: HttpError = new Error("Extraction failed");
      err.status = 502;
      throw err;
    }

    return { fields: toolBlock.input, usage: data.usage || {} };
  },
  };
}

export const ANTHROPIC_PROVIDER = createAnthropicProvider();
