import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createGmailPullWorker } from "./gmail-pull.ts";
import { createEmailIndexTestDb, seedEmailAccount } from "./test-utils/email-index-db.ts";
import type { EmailWriteDb } from "./email-persistence-types.ts";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
  vi.useRealTimers();
});

async function harness({ blockInsert = false, failInsert = false } = {}) {
  const db = await createEmailIndexTestDb();
  await seedEmailAccount(db, { id: "gmail-work", email: "work@example.com" });
  const stream = new EventEmitter();
  let opens = 0;
  let clientClosed = false;
  let streamClosed = false;
  let inserted = false;
  let release = () => {};
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const client = {
    subscription: () => Object.assign(stream, {
      open: () => { opens += 1; },
      close: async () => { streamClosed = true; stream.emit("close"); },
    }),
    close: async () => { clientClosed = true; },
  };
  const dbClient: EmailWriteDb = {
    execute: async (statement) => {
      const sql = typeof statement === "string" ? statement : statement.sql;
      if (sql.includes("INSERT INTO ea_triage_jobs")) {
        if (blockInsert) await gate;
        if (failInsert) throw new Error("private database detail");
        const result = await db.execute(statement);
        inserted = true;
        return result;
      }
      return db.execute(statement);
    },
    batch: (...args) => db.batch(...args),
  };
  const worker = createGmailPullWorker({
    subscriptionName: "projects/example-project/subscriptions/gmail-pull",
    createClient: () => client as never,
    dbClient,
  });
  cleanup.push(async () => { release(); await worker.stop(); db.close(); });
  function message(data = { emailAddress: "work@example.com", historyId: "12345" }) {
    const result = { acks: 0, nacks: 0, durableAtAck: false };
    return {
      result,
      id: "delivery-1", data: Buffer.from(JSON.stringify(data)), publishTime: new Date(),
      ack: () => { result.acks++; result.durableAtAck = inserted; },
      nack: () => { result.nacks++; },
    };
  }
  worker.start();
  return { db, worker, stream, message, release, closed: () => ({ clientClosed, streamClosed }), opens: () => opens };
}

describe("Gmail StreamingPull admission", () => {
  it("acknowledges only after durable admission and deduplicates repeated history notifications", async () => {
    const h = await harness({ blockInsert: true });
    const first = h.message();
    h.stream.emit("message", first);
    await Promise.resolve();
    expect(first.result.acks).toBe(0);
    expect(h.worker.getStatus().state).toBe("starting");
    h.release();
    await vi.waitFor(() => expect(first.result).toEqual({ acks: 1, nacks: 0, durableAtAck: true }));
    const duplicate = h.message();
    h.stream.emit("message", duplicate);
    await vi.waitFor(() => expect(duplicate.result.acks).toBe(1));
    const rows = (await h.db.execute("SELECT job_type, status, payload_json FROM ea_triage_jobs")).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ job_type: "gmail_history_sync", status: "queued" });
    expect(JSON.parse(String(rows[0]!.payload_json))).toMatchObject({ historyId: "12345", pubsubMessageId: "delivery-1" });
    expect(h.worker.getStatus()).toMatchObject({ state: "listening", lastMessageAt: expect.any(Number) });
  });

  it("does not let in-flight admission hide a later stream failure", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const h = await harness({ blockInsert: true });
    const message = h.message();
    h.stream.emit("message", message);
    h.stream.emit("error", new Error("connection failed"));
    h.stream.emit("close");
    h.release();
    await vi.waitFor(() => expect(message.result.acks).toBe(1));
    expect(h.worker.getStatus()).toMatchObject({ state: "retrying", lastMessageAt: expect.any(Number) });
  });

  it("retains delivery for retry when the durable queue cannot accept it", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const h = await harness({ failInsert: true });
    const message = h.message();
    h.stream.emit("message", message);
    await vi.waitFor(() => expect(message.result.nacks).toBe(1));
    expect(message.result.acks).toBe(0);
    expect((await h.db.execute("SELECT count(*) AS n FROM ea_triage_jobs")).rows[0]!.n).toBe(0);
    expect(h.worker.getStatus()).toMatchObject({ state: "retrying", lastMessageAt: null });
  });

  it("does not discard invalid or unknown-account notifications", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const h = await harness();
    for (const data of [{ emailAddress: "", historyId: "" }, { emailAddress: "other@example.com", historyId: "1" }]) {
      const message = h.message(data);
      h.stream.emit("message", message);
      await vi.waitFor(() => expect(message.result.nacks).toBe(1));
      expect(message.result.acks).toBe(0);
    }
  });

  it("waits for admitted work on shutdown and rejects new deliveries without acknowledging them", async () => {
    const h = await harness({ blockInsert: true });
    const message = h.message();
    h.stream.emit("message", message);
    const stop = h.worker.stop();
    const late = h.message();
    h.stream.emit("message", late);
    expect(late.result).toMatchObject({ acks: 0, nacks: 1 });
    expect(h.closed()).toEqual({ clientClosed: false, streamClosed: false });
    h.release();
    await stop;
    expect(message.result).toMatchObject({ acks: 1, durableAtAck: true });
    expect(h.closed()).toEqual({ clientClosed: true, streamClosed: true });
    expect(h.worker.getStatus().state).toBe("stopped");
    h.worker.start();
    expect(h.worker.getStatus().state).toBe("stopped");
  });

  it("reopens a terminated stream with backoff and cancels retries when stopped", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const h = await harness();
    vi.useFakeTimers();
    h.stream.emit("error", new Error("provider details must not be logged"));
    h.stream.emit("close");
    expect(h.worker.getStatus().state).toBe("retrying");
    await vi.advanceTimersByTimeAsync(1_000);
    expect(h.opens()).toBe(1);
    h.stream.emit("close");
    await h.worker.stop();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.opens()).toBe(1);
  });

  it("does not create a client when disabled or misconfigured", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    let created = 0;
    for (const subscriptionName of ["", "not-a-resource"]) {
      const worker = createGmailPullWorker({ subscriptionName, createClient: () => { created++; throw new Error(); } });
      worker.start();
      expect(worker.getStatus().state).toBe(subscriptionName ? "misconfigured" : "disabled");
      await worker.stop();
    }
    expect(created).toBe(0);
  });
});
