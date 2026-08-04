// OpenAI Responses API path with Structured Outputs (strict JSON schema).
// Returns the same normalized field shape as the Anthropic extractor so the
// caller does not branch on provider.

import { fetchWithTimeout } from "../../platform/fetch-with-timeout.ts";
import { resolveAiApiKey } from "../../ai-credentials.ts";
import type { BillCandidate, BillExtractionProvider, BillExtractionRequest } from "../../../shared/types/bills.ts";

type HttpError = Error & { status?: number };
interface OpenAiResponse {
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
    amount: { type: "number" },
    due_date: { type: "string" },
    type: { type: "string", enum: ["transfer", "bill", "expense", "income"] },
    category_code: { type: ["string", "null"] },
    category_name: { type: ["string", "null"] },
    to_account_code: { type: ["string", "null"] },
  },
  required: ["payee", "amount", "due_date", "type", "category_code", "category_name", "to_account_code"],
};

export function createOpenAiProvider({
  resolveApiKey = resolveAiApiKey,
}: {
  resolveApiKey?: typeof resolveAiApiKey;
} = {}): BillExtractionProvider & { id: string; envVar: string } {
  return {
  id: "openai",
  envVar: "OPENAI_API_KEY",

  async extract({ model, systemPrompt, content }: BillExtractionRequest) {
    const apiKey = await resolveApiKey("openai");
    if (!apiKey) {
      const err: HttpError = new Error("OPENAI_API_KEY not set");
      err.status = 503;
      throw err;
    }

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
        max_output_tokens: 400,
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

    if (!apiRes.ok) {
      await apiRes.text();
      console.error(`[EA] Bill extract OpenAI error (${apiRes.status})`);
      const err: HttpError = new Error(`OpenAI API error (${apiRes.status})`);
      err.status = 502;
      throw err;
    }

    const data = await apiRes.json() as OpenAiResponse;
    const text = extractOutputText(data);
    if (!text) {
      console.error("[EA] Bill extract: no output_text in OpenAI response", data);
      const err: HttpError = new Error("Extraction failed");
      err.status = 502;
      throw err;
    }

    let fields: BillCandidate;
    try {
      fields = JSON.parse(text) as BillCandidate;
    } catch (parseErr: unknown) {
      console.error("[EA] Bill extract: OpenAI returned non-JSON output", text, parseErr instanceof Error ? parseErr.message : String(parseErr));
      const err: HttpError = new Error("Extraction failed");
      err.status = 502;
      throw err;
    }

    return { fields, usage: data.usage || {} };
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
