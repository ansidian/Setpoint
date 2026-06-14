// OpenAI Responses API path with Structured Outputs (strict JSON schema).
// Returns the same normalized field shape as the Anthropic extractor so the
// caller does not branch on provider.

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

export const OPENAI_PROVIDER = {
  id: "openai",
  envVar: "OPENAI_API_KEY",

  async extract({ model, systemPrompt, content }) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      const err = new Error("OPENAI_API_KEY not set");
      err.status = 503;
      throw err;
    }

    const apiRes = await fetch("https://api.openai.com/v1/responses", {
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
    });

    if (!apiRes.ok) {
      const text = await apiRes.text();
      console.error(`[EA] Bill extract OpenAI error (${apiRes.status}):`, text);
      const err = new Error(`OpenAI API error (${apiRes.status})`);
      err.status = 502;
      throw err;
    }

    const data = await apiRes.json();
    const text = extractOutputText(data);
    if (!text) {
      console.error("[EA] Bill extract: no output_text in OpenAI response", data);
      const err = new Error("Extraction failed");
      err.status = 502;
      throw err;
    }

    let fields;
    try {
      fields = JSON.parse(text);
    } catch (parseErr) {
      console.error("[EA] Bill extract: OpenAI returned non-JSON output", text, parseErr.message);
      const err = new Error("Extraction failed");
      err.status = 502;
      throw err;
    }

    return { fields, usage: data.usage || {} };
  },
};

function extractOutputText(data) {
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
