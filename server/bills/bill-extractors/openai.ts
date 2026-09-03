import { BILL_SEMANTIC_IDENTITY_PROPERTIES, BILL_SEMANTIC_IDENTITY_REQUIRED } from "../bill-semantic-prompt.ts";
// OpenAI Responses API path with Structured Outputs (strict JSON schema).
// Returns the same normalized field shape as the Anthropic extractor so the
// caller does not branch on provider.

import { fetchWithTimeout } from "../../platform/fetch-with-timeout.ts";
import { resolveAiApiKey } from "../../ai-credentials.ts";
import { trackedAiProviderCall } from "../../platform/ai-usage.ts";
import type { BillCandidate, BillExtractionProvider, BillExtractionRequest } from "../../../shared/types/bills.ts";
import { BILL_AMOUNT_KINDS, BILL_EVENT_KINDS } from "../../../shared/types/bills.ts";

type HttpError = Error & { status?: number };
interface OpenAiResponse {
  status?: string;
  incomplete_details?: { reason?: string } | null;
  output_text?: string;
  output?: Array<{ type?: string; content?: Array<{ type?: string; text?: string }> }>;
  usage?: Record<string, unknown>;
}

// LLM completions legitimately run long; this deadline is a wedge-breaker
// (guards against a hung connection), not a latency budget.
const BILL_EXTRACT_TIMEOUT_MS = 120_000;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    payee: { type: "string" },
    amount: { type: ["number", "null"] },
    amount_kind: { type: ["string", "null"], enum: [...BILL_AMOUNT_KINDS, null] },
    amount_candidates: {
      type: "array",
      maxItems: 8,
      items: {
        type: "object",
        additionalProperties: false,
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
    ...BILL_SEMANTIC_IDENTITY_PROPERTIES,
    category_code: { type: ["string", "null"] },
    category_name: { type: ["string", "null"] },
    to_account_code: { type: ["string", "null"] },
  },
  required: ["payee", "amount", "amount_kind", "amount_candidates", "event_kind", "event_confidence", "event_evidence", "account_last4", "account_last4_evidence", "account_last4_confidence", "target_policy_key", "target_confidence", "target_evidence", "due_date", "currency", ...BILL_SEMANTIC_IDENTITY_REQUIRED, "category_code", "category_name", "to_account_code"],
};

export function createOpenAiProvider({
  resolveApiKey = resolveAiApiKey,
}: {
  resolveApiKey?: typeof resolveAiApiKey;
} = {}): BillExtractionProvider & { id: string; envVar: string } {
  return {
  id: "openai",
  envVar: "OPENAI_API_KEY",

  async extract({ model, systemPrompt, content, usagePurpose = "extraction" }: BillExtractionRequest) {
    const apiKey = await resolveApiKey("openai");
    if (!apiKey) {
      const err: HttpError = new Error("OPENAI_API_KEY not set");
      err.status = 503;
      throw err;
    }

    return trackedAiProviderCall({ provider: "openai", model, purpose: usagePurpose }, async (call) => {
      const apiRes = await fetchWithTimeout("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          instructions: systemPrompt,
          input: content,
          max_output_tokens: 1600,
          reasoning: { effort: "low" },
          text: {
            format: {
              type: "json_schema",
              name: "submit_bill",
              schema: SCHEMA,
              strict: true,
            },
          },
        }),
      }, { timeoutMs: BILL_EXTRACT_TIMEOUT_MS });
      call.setHttpStatus(apiRes.status);

      if (!apiRes.ok) {
        await apiRes.text();
        console.error(`[EA] Bill extract OpenAI error (${apiRes.status})`);
        const err: HttpError = new Error(`OpenAI API error (${apiRes.status})`);
        err.status = 502;
        throw err;
      }

      const data = await apiRes.json() as OpenAiResponse;
      await call.capture(data);
      const text = extractOutputText(data);
      if (!text) {
        console.error("[EA] Bill extract: no output_text in OpenAI response", {
          status: data.status,
          incompleteReason: data.incomplete_details?.reason,
        });
        const err: HttpError = new Error("Extraction failed");
        err.status = 502;
        throw err;
      }

      let fields: BillCandidate;
      try {
        fields = JSON.parse(text) as BillCandidate;
      } catch (parseErr: unknown) {
        console.error("[EA] Bill extract: OpenAI returned an invalid structured response", parseErr instanceof Error ? parseErr.message : String(parseErr));
        const err: HttpError = new Error("Extraction failed");
        err.status = 502;
        throw err;
      }

      return { fields, usage: data.usage || {} };
    });
  },
  };
}

export const OPENAI_PROVIDER = createOpenAiProvider();

function extractOutputText(data: OpenAiResponse): string | null {
  if (typeof data.output_text === "string" && data.output_text.length) {
    return data.output_text;
  }
  for (const item of data.output || []) {
    if (item.type !== "message") continue;
    for (const block of item.content || []) {
      if (block.type === "output_text" && typeof block.text === "string") return block.text;
    }
  }
  return null;
}
