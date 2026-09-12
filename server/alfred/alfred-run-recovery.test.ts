import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createEmailIndexTestDb, seedIndexedEmail } from "../email/test-utils/email-index-db.ts";
import { retrieveInboxAiSearch } from "../email/search/email-search-retrieval.ts";
import { createAlfredConversation, clearAlfredConversations } from "./alfred-conversations.ts";
import { runAlfred } from "./alfred-run.ts";
import { recordAlfredUsage } from "./alfred-usage.ts";
import type { AlfredProvider, AlfredRunEvent } from "../../shared/types/alfred.ts";
import type { AlfredDependencies, AlfredFetch, AlfredUsageRecorder } from "./alfred-types.ts";

type ScriptTurn = string | { name: string; input: Record<string, unknown> };

// Only the outbound model is scripted; run orchestration, tools, indexed retrieval,
// source caching and the usage ledger work together against an ephemeral database.
function modelScript(provider: AlfredProvider, turns: ScriptTurn[]): AlfredFetch {
  let index = 0;
  return async () => {
    const turn = turns[index++];
    if (turn == null) throw new Error("Unexpected model continuation");
    const isText = typeof turn === "string";
    const id = `call-${index}`;
    const frames = provider === "anthropic" ? [
      { type: "message_start", message: { model: "claude-haiku-4-5", usage: { input_tokens: 1 } } },
      { type: "content_block_start", index: 0, content_block: isText
        ? { type: "text", text: "" } : { type: "tool_use", id, name: turn.name } },
      { type: "content_block_delta", index: 0, delta: isText
        ? { type: "text_delta", text: turn } : { type: "input_json_delta", partial_json: JSON.stringify(turn.input) } },
      { type: "content_block_stop", index: 0 },
      { type: "message_delta", delta: { stop_reason: isText ? "end_turn" : "tool_use" }, usage: { output_tokens: 1 } },
      { type: "message_stop" },
    ] : [
      ...(isText ? [{ type: "response.output_text.delta", delta: turn }] : []),
      { type: "response.completed", response: {
        status: "completed", model: "gpt-5.6-sol", usage: { input_tokens: 1, output_tokens: 1 },
        output: [isText
          ? { type: "message", id, role: "assistant", content: [{ type: "output_text", text: turn }] }
          : { type: "function_call", id, call_id: id, name: turn.name, arguments: JSON.stringify(turn.input) }],
      } },
    ];
    return {
      ok: true, status: 200, text: async () => "",
      body: (async function* () {
        for (const frame of frames) yield `data: ${JSON.stringify(frame)}\n\n`;
      })(),
    };
  };
}

describe("Alfred search recovery and source display", () => {
  let db: Awaited<ReturnType<typeof createEmailIndexTestDb>>;
  let pendingUsage: Promise<unknown>[];
  const now = new Date("2026-09-12T01:07:00Z");
  beforeEach(async () => {
    db = await createEmailIndexTestDb({ extraMigrations: [
      "006_email_search_embedding_state.sql", "016_alfred_usage.sql", "019_alfred_usage_cache_creation.sql",
    ] });
    pendingUsage = [];
    clearAlfredConversations();
  });
  afterEach(async () => {
    await Promise.all(pendingUsage);
    db.close();
  });

  async function run(provider: AlfredProvider, turns: ScriptTurn[], extraDeps: Partial<AlfredDependencies> = {}) {
    const events: AlfredRunEvent[] = [];
    const conversation = createAlfredConversation({ provider, model: provider === "anthropic" ? "claude-haiku-4-5" : "gpt-5.6-sol" });
    const recordUsage: AlfredUsageRecorder = (userId, input) => {
      const pending = recordAlfredUsage(userId, { ...input, dbClient: db, createdAt: now });
      pendingUsage.push(pending);
      return pending;
    };
    await runAlfred({
      userId: "user-1", conversation, message: "Find emails about a credit limit change",
      emit: (event) => events.push(event), apiKey: "test-key", now: () => now,
      fetchImpl: modelScript(provider, turns), recordUsage,
      deps: {
        retrieve: (userId, input) => retrieveInboxAiSearch(userId, {
          ...input, dbClient: db, now: now.getTime(), capability: { mode: "fallback" },
          embeddingClient: { embed: async () => [[1, 0, 0]] },
          recordUsage: async () => {}, coverageRatio: 0,
        }),
        ...extraDeps,
      } as AlfredDependencies,
    });
    await Promise.all(pendingUsage);
    const usage = (await db.execute("SELECT metadata_json FROM ea_alfred_usage WHERE event_type = 'alfred_tool_call' ORDER BY id"))
      .rows.map((row) => JSON.parse(String(row.metadata_json)));
    return { events, usage };
  }

  it.each(["anthropic", "openai"] as const)("keeps %s source reminders active across multiple search pages", async (provider) => {
    for (let i = 0; i < 13; i++) await seedIndexedEmail(db, {
      uid: `notice-${i}`, subject: `Credit limit notice ${i}`, body_text: "A credit limit changed.",
      email_date: "2026-09-12T00:57:54Z",
    });
    const { events } = await run(provider, [
      { name: "search_email", input: { query: "credit limit" } },
      { name: "search_email", input: { query: "credit limit notice" } },
      "I found a credit limit notice.",
      { name: "show_items", input: { kind: "email", ids: ["notice-0"] } },
      "This reports a decrease but does not identify the account.",
    ]);
    expect(events.filter((event) => event.type === "rows")).toMatchObject([
      { kind: "email", items: [{ uid: "notice-0", subject: "Credit limit notice 0" }] },
    ]);
    expect(events.at(-1)?.type).toBe("run_end");
  });

  it("explains missing search input in the stream and persists a content-free reason", async () => {
    const { events, usage } = await run("anthropic", [
      { name: "search_email", input: {} }, "The search needs search terms.",
    ]);
    expect(events.find((event) => event.type === "tool_result")).toMatchObject({
      ok: false, summary: expect.stringMatching(/search (?:terms|query).*missing/i),
    });
    expect(usage[0]).toMatchObject({
      tool: "search_email", ok: false, tool_id: "call-1",
      failure: { code: "missing_query", stage: "validation" },
    });
  });

  it("preserves safe diagnostics for a real search-parser rejection", async () => {
    const { events, usage } = await run("anthropic", [
      { name: "search_email", input: { query: "is:important private search terms" } },
      "That filter is unsupported; I can retry with keywords.",
    ]);
    expect(events.find((event) => event.type === "tool_result")).toMatchObject({
      ok: false, summary: expect.stringMatching(/unsupported.*filter/i),
    });
    expect(usage[0].failure).toMatchObject({ code: "unsupported_email_search_flag", status: 400 });
    expect(JSON.stringify({ events, usage })).not.toContain("private search terms");
  });

  it.each([
    { status: 429, code: "rate_limited", summary: /too many requests|rate limit/i },
    { status: 401, code: "access_denied", summary: /access was denied/i },
    { status: 503, code: "service_unavailable", summary: /temporarily unavailable/i },
    { status: undefined, code: "tool_failed", summary: /without an identified cause/i },
  ])("explains $code without exposing raw errors in the stream or ledger", async ({ status, code, summary }) => {
    const { events, usage } = await run("openai", [
      { name: "get_email_body", input: { uid: "private-mail-id" } },
      "That message could not be opened.",
    ], { getEmailBody: async () => { throw Object.assign(new Error("secret-token private-email-body"), { status }); } });
    expect(events.find((event) => event.type === "tool_result")).toMatchObject({
      ok: false, summary: expect.stringMatching(summary),
    });
    expect(usage[0].failure).toMatchObject({ code, stage: "execution", ...(status ? { status } : {}) });
    expect(JSON.stringify({ events, usage })).not.toMatch(/secret-token|private-email-body|private-mail-id/);
  });
});
