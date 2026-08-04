import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@libsql/client";
import type { Client, InStatement } from "@libsql/client";
import cookieParser from "cookie-parser";
import crypto from "crypto";
import express from "express";
import request from "../test-utils/supertest.ts";
import type { Test } from "../test-utils/supertest.ts";
import type { RunAlfredOptions } from "../alfred/alfred-types.ts";

const testState = vi.hoisted(() => ({
  db: { current: null as Client | null },
  run: vi.fn<(options: RunAlfredOptions) => Promise<void>>(),
  modelConfig: { provider: "anthropic" as "anthropic" | "openai", model: "claude-sonnet-4-6" },
}));

// test-architecture: allow-boundary-mock -- Redirects the auth and Alfred usage database singleton to ephemeral libSQL; real session SQL gates the HTTP/SSE route and no database behavior is stubbed.
vi.mock("../db/connection.ts", () => ({
  default: {
    execute: (statement: InStatement) => testState.db.current!.execute(statement),
    executeMultiple: (sql: string) => testState.db.current!.executeMultiple(sql),
    batch: (statements: InStatement[]) => testState.db.current!.batch(statements),
  },
}));

const { createAlfredRouter } = await import("./alfred.ts");
const { clearAlfredConversations } = await import("../alfred/alfred-conversations.ts");

function hashSessionToken(raw: string): string {
  return `sha256:${crypto.createHash("sha256").update(raw).digest("hex")}`;
}

async function createMigratedDb(): Promise<Client> {
  const db = createClient({ url: "file::memory:" });
  await db.executeMultiple(`
    CREATE TABLE ea_owner (
      singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
      user_id TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      auth_mode TEXT NOT NULL DEFAULT 'password_or_passkey',
      security_generation INTEGER NOT NULL DEFAULT 1,
      claimed_at INTEGER NOT NULL
    );
    CREATE TABLE ea_sessions (
      token TEXT PRIMARY KEY,
      expires_at INTEGER NOT NULL,
      authenticated_at INTEGER NOT NULL DEFAULT 0,
      password_authenticated_at INTEGER NOT NULL DEFAULT 0,
      security_generation INTEGER NOT NULL DEFAULT 1,
      auth_method TEXT NOT NULL DEFAULT 'legacy'
    );
    INSERT INTO ea_owner
      (singleton_id, user_id, password_hash, auth_mode, security_generation, claimed_at)
    VALUES (1, 'user-1', 'unused-test-hash', 'password_or_passkey', 1, 1);
  `);
  await db.execute({
    sql: "INSERT INTO ea_sessions (token, expires_at) VALUES (?, ?)",
    args: [hashSessionToken("cookie-session"), Date.now() + 60_000],
  });
  return db;
}

function buildApp(): express.Express {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use("/api/alfred", createAlfredRouter({
    run: testState.run,
    credentialResolver: async (provider) => (
      provider === "openai" ? process.env.OPENAI_API_KEY : process.env.ANTHROPIC_API_KEY
    ) || null,
    modelConfigResolver: async () => testState.modelConfig,
  }));
  return app;
}

function auth(requestBuilder: Test): Test {
  return requestBuilder.set("Cookie", ["ea_session=cookie-session"]);
}

describe("alfred routes", () => {
  beforeEach(async () => {
    vi.stubEnv("EA_USER_ID", "user-1");
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    vi.stubEnv("OPENAI_API_KEY", "openai-test-key");
    testState.modelConfig = { provider: "anthropic", model: "claude-sonnet-4-6" };
    testState.db.current = await createMigratedDb();
    testState.run.mockReset();
    clearAlfredConversations();
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await testState.db.current?.close?.();
    testState.db.current = null;
  });

  it("requires a session", async () => {
    const res = await request(buildApp()).post("/api/alfred/run").send({ message: "hi" });
    expect(res.status).toBe(401);
  });

  it("requires a session for usage stats", async () => {
    const res = await request(buildApp()).get("/api/alfred/usage");
    expect(res.status).toBe(401);
  });

  it("returns Alfred usage stats for an authed session", async () => {
    const res = await auth(request(buildApp()).get("/api/alfred/usage"));
    expect(res.status).toBe(200);
    // No ea_alfred_usage table in this in-memory db → empty summary, not an error.
    expect(res.body).toMatchObject({ queries: 0, tools: { totalCalls: 0 } });
  });

  it("rejects an empty message", async () => {
    const res = await auth(request(buildApp()).post("/api/alfred/run")).send({ message: "  " });
    expect(res.status).toBe(400);
  });

  it("ignores deprecated client model input and uses Settings", async () => {
    const res = await auth(request(buildApp()).post("/api/alfred/run")).send({
      message: "hi",
      model: "gpt-5.5",
    });
    expect(res.status).toBe(200);
    expect(testState.run.mock.calls[0]?.[0].conversation.model).toBe("claude-sonnet-4-6");
  });

  it("returns 503 when ANTHROPIC_API_KEY is missing", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    const res = await auth(request(buildApp()).post("/api/alfred/run")).send({ message: "hi" });
    expect(res.status).toBe(503);
  });

  it("does not fall back to Anthropic when the selected OpenAI credential is missing", async () => {
    testState.modelConfig = { provider: "openai", model: "gpt-5.6-sol" };
    vi.stubEnv("OPENAI_API_KEY", "");

    const res = await auth(request(buildApp()).post("/api/alfred/run")).send({ message: "hi" });

    expect(res.status).toBe(503);
    expect(JSON.stringify(res.body)).toContain("OPENAI_API_KEY");
  });

  it("streams run events as SSE and reports the conversation id", async () => {
    testState.run.mockImplementation(async ({ emit, conversation, userId, message }) => {
      expect(conversation.messages).toEqual([]);
      emit({ type: "text_delta", text: `${userId}:${message}` });
      emit({ type: "run_end", stop_reason: "end_turn" });
    });

    const res = await auth(request(buildApp()).post("/api/alfred/run")).send({ message: "What's left?" });

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/event-stream");
    expect(res.text).toContain("event: run_start");
    expect(res.text).toContain('"text":"user-1:What\'s left?"');
    expect(res.text).toContain("event: run_end");
    const startEvent = JSON.parse(
      res.text.split("\n\n").find((frame: string) => frame.includes("run_start"))!.split("data: ")[1]!,
    );
    expect(startEvent.conversation_id).toBeTruthy();
    expect(startEvent.provider).toBe("anthropic");
    expect(startEvent.model).toBe("claude-sonnet-4-6");
  });

  it("uses the OpenAI provider and credential selected in Settings", async () => {
    testState.modelConfig = { provider: "openai", model: "gpt-5.6-sol" };
    testState.run.mockImplementation(async ({ emit }) => {
      emit({ type: "run_end", stop_reason: "completed" });
    });

    const res = await auth(request(buildApp()).post("/api/alfred/run")).send({ message: "hi" });

    expect(res.status).toBe(200);
    const startEvent = JSON.parse(
      res.text.split("\n\n").find((frame: string) => frame.includes("run_start"))!.split("data: ")[1]!,
    );
    expect(startEvent).toMatchObject({ provider: "openai", model: "gpt-5.6-sol" });
    expect(testState.run.mock.calls[0]?.[0].apiKey).toBe("openai-test-key");
  });

  it("reuses an existing conversation when conversationId is supplied", async () => {
    let firstConversationId: string | undefined;
    testState.run.mockImplementation(async ({ emit, conversation }) => {
      firstConversationId = conversation.id;
      emit({ type: "run_end", stop_reason: "end_turn" });
    });
    const app = buildApp();
    await auth(request(app).post("/api/alfred/run")).send({ message: "first" });

    testState.modelConfig = { provider: "openai", model: "gpt-5.6-sol" };

    let secondConversationId: string | undefined;
    testState.run.mockImplementation(async ({ emit, conversation }) => {
      secondConversationId = conversation.id;
      emit({ type: "run_end", stop_reason: "end_turn" });
    });
    await auth(request(app).post("/api/alfred/run")).send({
      message: "second",
      conversationId: firstConversationId,
    });

    expect(secondConversationId).toBe(firstConversationId);
    expect(testState.run.mock.calls[1]?.[0].conversation).toMatchObject({
      provider: "anthropic",
      model: "claude-sonnet-4-6",
    });
  });

  it("emits run_error when the run loop throws", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    testState.run.mockRejectedValue(new Error("api down"));
    const res = await auth(request(buildApp()).post("/api/alfred/run")).send({ message: "hi" });
    expect(res.text).toContain("event: run_error");
  });

  it("deletes a conversation", async () => {
    let conversationId: string | undefined;
    testState.run.mockImplementation(async ({ emit, conversation }) => {
      conversationId = conversation.id;
      emit({ type: "run_end", stop_reason: "end_turn" });
    });
    const app = buildApp();
    await auth(request(app).post("/api/alfred/run")).send({ message: "hi" });

    const res = await auth(request(app).delete(`/api/alfred/conversations/${conversationId}`));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });
});
