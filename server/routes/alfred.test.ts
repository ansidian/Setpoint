import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@libsql/client";
import type { Client, InStatement } from "@libsql/client";
import cookieParser from "cookie-parser";
import crypto from "crypto";
import express from "express";
import request, { fetchApp } from "../test-utils/supertest.ts";
import { runAlfred } from "../alfred/alfred-run.ts";
import type { Test } from "../test-utils/supertest.ts";
import type { RunAlfredOptions } from "../alfred/alfred-types.ts";
import type { EmailBody } from "../../shared/types/email.ts";

const testState = vi.hoisted(() => ({
  db: { current: null as Client | null },
  run: vi.fn<(options: RunAlfredOptions) => Promise<void>>(),
  getEmailBody: vi.fn<(userId: string, uid: string) => Promise<EmailBody>>(),
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

function buildApp(run: typeof runAlfred = testState.run): express.Express {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use("/api/alfred", createAlfredRouter({
    run,
    credentialResolver: async (provider) => (
      provider === "openai" ? process.env.OPENAI_API_KEY : process.env.ANTHROPIC_API_KEY
    ) || null,
    modelConfigResolver: async () => testState.modelConfig,
    emailContextDeps: { getEmailBody: testState.getEmailBody },
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
    testState.getEmailBody.mockReset();
    testState.getEmailBody.mockResolvedValue({
      html_body: "<p>Complete provider body</p>",
      subject: "Provider subject",
      from: "Pat <pat@example.com>",
      date: "2026-08-14T12:00:00-07:00",
    });
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

  it("requires a session to prepare email context", async () => {
    const res = await request(buildApp()).post("/api/alfred/email-context").send({ uid: "mail-1" });
    expect(res.status).toBe(401);
  });

  it("prepares email context without a model call and consumes it only after a successful run", async () => {
    const app = buildApp();
    const prepared = await auth(request(app).post("/api/alfred/email-context")).send({
      uid: "mail-1",
      subject: "List subject",
      senderName: "List sender",
      timestamp: "2026-08-14T11:00:00-07:00",
    });

    expect(prepared.status).toBe(201);
    expect(prepared.body).toMatchObject({
      uid: "mail-1",
      subject: "Provider subject",
      sender: { name: "Pat", address: "pat@example.com" },
    });
    expect(prepared.body).not.toHaveProperty("modelText");
    // test-architecture: allow-boundary-interaction -- Model-free preparation must not cross the Alfred runner/provider boundary before the owner sends a prompt.
    expect(testState.run).not.toHaveBeenCalled();

    testState.run.mockImplementation(async ({ emailContext, emit }) => {
      expect(emailContext?.modelText).toContain("Complete provider body");
      emit({ type: "run_end", stop_reason: "end_turn" });
    });
    const sent = await auth(request(app).post("/api/alfred/run")).send({
      message: "What should I do?",
      emailContextId: prepared.body.contextId,
    });
    expect(sent.status).toBe(200);
    expect(sent.text).toContain("event: run_end");

    const reused = await auth(request(app).post("/api/alfred/run")).send({
      message: "Reuse it",
      emailContextId: prepared.body.contextId,
    });
    expect(reused.status).toBe(409);
    expect(reused.body.code).toBe("email_context_expired");
  });

  it("releases prepared email context when a run fails so the same handle can retry", async () => {
    const app = buildApp();
    const prepared = await auth(request(app).post("/api/alfred/email-context")).send({ uid: "mail-1" });
    testState.run.mockImplementationOnce(async ({ emit }) => {
      emit({ type: "run_error", message: "Temporary failure" });
    });
    const failed = await auth(request(app).post("/api/alfred/run")).send({
      message: "Try once",
      emailContextId: prepared.body.contextId,
    });
    expect(failed.status).toBe(200);
    expect(failed.text).toContain("event: run_error");

    testState.run.mockImplementationOnce(async ({ emit }) => {
      emit({ type: "run_end", stop_reason: "end_turn" });
    });
    const retried = await auth(request(app).post("/api/alfred/run")).send({
      message: "Try again",
      emailContextId: prepared.body.contextId,
    });
    expect(retried.status).toBe(200);
    expect(retried.text).toContain("event: run_end");
  });

  it("cancels provider work when the response disconnects and releases its email attachment for retry", async () => {
    let providerCancelled = false;
    let finishRun!: () => void;
    const runFinished = new Promise<void>((resolve) => { finishRun = resolve; });
    // Exercise the real runner and adapter; only the remote provider fetch is held
    // open. The observable contract is cancellation and attachment reuse over HTTP.
    const app = buildApp(async (options) => {
      try {
        await runAlfred({
          ...options,
          fetchImpl: async (_url, init) => new Promise<Response>((_resolve, reject) => {
            const cancel = () => {
              providerCancelled = true;
              reject(new DOMException("Client disconnected", "AbortError"));
            };
            if (init?.signal?.aborted) cancel();
            else init?.signal?.addEventListener("abort", cancel, { once: true });
          }),
        });
      } finally {
        finishRun();
      }
    });
    const prepared = await auth(request(app).post("/api/alfred/email-context")).send({ uid: "mail-stop" });
    const controller = new AbortController();
    try {
      const response = await fetchApp(app, "/api/alfred/run", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: "ea_session=cookie-session" },
        body: JSON.stringify({ message: "Read this email", emailContextId: prepared.body.contextId }),
        signal: controller.signal,
      });
      const first = await response.body!.getReader().read();
      expect(new TextDecoder().decode(first.value)).toContain("event: run_start");
      expect(providerCancelled).toBe(false);
      controller.abort();
      await runFinished;
      expect(providerCancelled).toBe(true);
    } finally {
      controller.abort();
    }

    testState.run.mockImplementationOnce(async ({ emit }) => {
      emit({ type: "run_end", stop_reason: "end_turn" });
    });
    const retried = await auth(request(buildApp()).post("/api/alfred/run")).send({
      message: "Try again", emailContextId: prepared.body.contextId,
    });
    expect(retried.status).toBe(200);
    expect(retried.text).toContain("event: run_end");
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
    // test-architecture: allow-boundary-interaction -- The route-to-Alfred runner handoff crosses the AI-provider use-case boundary; selected model, isolated key, and continuation are the request contract.
    expect(testState.run.mock.calls[0]?.[0].conversation.model).toBe("claude-sonnet-4-6");
  });

  it("returns 503 when ANTHROPIC_API_KEY is missing", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    const res = await auth(request(buildApp()).post("/api/alfred/run")).send({ message: "hi" });
    expect(res.status).toBe(503);
  });

  it("releases claimed email context when run setup cannot resolve a credential", async () => {
    const app = buildApp();
    const prepared = await auth(request(app).post("/api/alfred/email-context")).send({ uid: "mail-credential" });
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    const unavailable = await auth(request(app).post("/api/alfred/run")).send({
      message: "Read it",
      emailContextId: prepared.body.contextId,
    });
    expect(unavailable.status).toBe(503);

    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    testState.run.mockImplementationOnce(async ({ emit }) => {
      emit({ type: "run_end", stop_reason: "end_turn" });
    });
    const retried = await auth(request(app).post("/api/alfred/run")).send({
      message: "Read it",
      emailContextId: prepared.body.contextId,
    });
    expect(retried.status).toBe(200);
    expect(retried.text).toContain("event: run_end");
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
    expect(new Date(startEvent.expires_at).getTime()).toBeGreaterThan(Date.now());
  });

  it("acknowledges Created idempotently without accepting saved-event content", async () => {
    let conversationId = "";
    testState.run.mockImplementation(async ({ emit, conversation }) => {
      conversationId = conversation.id;
      const proposal = {
        id: "proposal-1",
        revisionOf: null,
        title: "Project review",
        allDay: false,
        startDate: "2026-08-18",
        endDate: "2026-08-18",
        startTime: "15:00",
        endTime: "15:30",
        location: "",
        description: "",
        source: { kind: "unavailable" as const },
        duplicateCheckUnavailable: true,
        past: false,
      };
      conversation.calendarProposalState.proposals.set(proposal.id, { proposal, status: "proposed" });
      conversation.calendarProposalState.activeProposalId = proposal.id;
      emit({ type: "run_end", stop_reason: "end_turn" });
    });
    const app = buildApp();
    await auth(request(app).post("/api/alfred/run")).send({ message: "Schedule a project review" });

    const rejectedContent = await auth(request(app)
      .post(`/api/alfred/conversations/${conversationId}/proposals/proposal-1/created`))
      .send({ event: { title: "must not be stored" } });
    expect(rejectedContent.status).toBe(400);

    const first = await auth(request(app)
      .post(`/api/alfred/conversations/${conversationId}/proposals/proposal-1/created`))
      .send({});
    const second = await auth(request(app)
      .post(`/api/alfred/conversations/${conversationId}/proposals/proposal-1/created`))
      .send({});
    expect(first.body).toEqual({ ok: true, status: "created" });
    expect(second.body).toEqual({ ok: true, status: "created" });
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
    // test-architecture: allow-boundary-interaction -- The route-to-Alfred runner handoff crosses the AI-provider use-case boundary; selected model, isolated key, and continuation are the request contract.
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
    // test-architecture: allow-boundary-interaction -- The route-to-Alfred runner handoff crosses the AI-provider use-case boundary; selected model, isolated key, and continuation are the request contract.
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
