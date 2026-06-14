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

export const ANTHROPIC_PROVIDER = {
  id: "anthropic",
  envVar: "ANTHROPIC_API_KEY",

  async extract({ model, systemPrompt, content }) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      const err = new Error("ANTHROPIC_API_KEY not set");
      err.status = 503;
      throw err;
    }

    const apiRes = await fetch("https://api.anthropic.com/v1/messages", {
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
    });

    if (!apiRes.ok) {
      const text = await apiRes.text();
      console.error(`[EA] Bill extract Anthropic error (${apiRes.status}):`, text);
      const err = new Error(`Anthropic API error (${apiRes.status})`);
      err.status = 502;
      throw err;
    }

    const data = await apiRes.json();
    const toolBlock = (data.content || []).find(
      (c) => c.type === "tool_use" && c.name === "submit_bill",
    );
    if (!toolBlock?.input) {
      console.error("[EA] Bill extract: no tool_use in Anthropic response", data);
      const err = new Error("Extraction failed");
      err.status = 502;
      throw err;
    }

    return { fields: toolBlock.input, usage: data.usage || {} };
  },
};
