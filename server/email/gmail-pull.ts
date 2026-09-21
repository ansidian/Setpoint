import { PubSub } from "@google-cloud/pubsub";
import type { Message, Subscription } from "@google-cloud/pubsub";
import type { EmailWriteDb } from "./email-persistence-types.ts";

type PullState = "disabled" | "starting" | "listening" | "retrying" | "stopped" | "misconfigured";
type PullClient = Pick<PubSub, "subscription" | "close">;
type PullMessage = Pick<Message, "id" | "data" | "publishTime" | "ack" | "nack">;

/** Owns only outbound notification admission; the existing queue owns Gmail sync. */
export function createGmailPullWorker({
  subscriptionName = process.env.GMAIL_PUBSUB_SUBSCRIPTION?.trim() || "",
  createClient = (projectId: string): PullClient => new PubSub({ projectId }),
  dbClient,
  requestDrain = () => {},
}: {
  subscriptionName?: string;
  createClient?: (projectId: string) => PullClient;
  dbClient?: EmailWriteDb;
  requestDrain?: () => void;
} = {}) {
  let state: PullState = "disabled";
  let lastMessageAt: number | null = null;
  let lastErrorAt: number | null = null;
  let client: PullClient | null = null;
  let subscription: Subscription | null = null;
  let running = false;
  let stopped = false;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let retryDelay = 1_000;
  let connectionGeneration = 0;
  let stopPromise: Promise<void> | null = null;
  const inFlight = new Set<Promise<void>>();

  function failure() {
    state = "retrying";
    lastErrorAt = Date.now();
    // Provider errors can contain credentials or notification contents.
    console.error("[Gmail Pull] Delivery unavailable; periodic inbox checks remain enabled");
  }

  async function admit(message: PullMessage, generation: number) {
    try {
      // Status readers must not initialize the sync/snapshot dependency graph.
      const { enqueueHistorySyncFromPubSub } = await import("./gmail-sync.ts");
      await enqueueHistorySyncFromPubSub({
        subscription: subscriptionName,
        message: {
          data: message.data.toString("base64"),
          messageId: message.id,
          publishTime: message.publishTime.toISOString(),
        },
      }, { dbClient });
    } catch {
      failure();
      message.nack();
      return;
    }
    // Redelivery after a lost ack is safe: queue admission is idempotent by account/history ID.
    message.ack();
    lastMessageAt = Date.now();
    if (running && generation === connectionGeneration) state = "listening";
    retryDelay = 1_000;
    console.info("[Gmail Pull] Notification durably queued");
    try {
      requestDrain();
    } catch {
      // The periodic queue drain can still process the already-persisted notification.
      console.error("[Gmail Pull] Immediate sync wakeup unavailable; queued work retained");
    }
  }

  function onMessage(message: Message) {
    if (!running) {
      message.nack();
      return;
    }
    const work = admit(message, connectionGeneration).catch(() => {
      if (running) failure();
      // If acknowledgement fails, let the provider redeliver rather than discard data.
    });
    inFlight.add(work);
    void work.finally(() => inFlight.delete(work));
  }

  function scheduleRetry() {
    if (!running || retryTimer) return;
    state = "retrying";
    lastErrorAt = Date.now();
    retryTimer = setTimeout(() => {
      retryTimer = null;
      if (running) open();
    }, retryDelay);
    retryTimer.unref?.();
    retryDelay = Math.min(retryDelay * 2, 60_000);
  }

  function open() {
    if (!running) return;
    try {
      if (!client) client = createClient(subscriptionName.split("/")[1]!);
      if (!subscription) {
        subscription = client.subscription(subscriptionName, {
          flowControl: { maxMessages: 10, maxBytes: 1024 * 1024, allowExcessMessages: false },
          streamingOptions: { maxStreams: 1 },
        });
        subscription.on("error", () => {
          connectionGeneration++;
          if (running) failure();
        });
        subscription.on("close", () => { connectionGeneration++; scheduleRetry(); });
        subscription.on("message", onMessage);
      } else {
        subscription.open();
      }
    } catch {
      failure();
      scheduleRetry();
    }
  }

  function start() {
    if (running || stopped || !subscriptionName) return;
    if (!/^projects\/[a-z][a-z0-9-]+\/subscriptions\/[A-Za-z][A-Za-z0-9._~+%-]+$/.test(subscriptionName)) {
      state = "misconfigured";
      lastErrorAt = Date.now();
      console.error("[Gmail Pull] Expected a full Pub/Sub subscription resource name");
      return;
    }
    running = true;
    state = "starting";
    open();
  }

  function stop(): Promise<void> {
    if (stopPromise) return stopPromise;
    stopped = true;
    running = false;
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = null;
    stopPromise = (async () => {
      // Reject new deliveries while finishing admission before flushing SDK acknowledgements.
      await Promise.allSettled([...inFlight]);
      try {
        await subscription?.close();
      } finally {
        await client?.close();
        state = subscriptionName ? "stopped" : "disabled";
      }
    })();
    return stopPromise;
  }

  return { start, stop, getStatus: () => ({ state, lastMessageAt, lastErrorAt }) };
}

let worker: ReturnType<typeof createGmailPullWorker> | null = null;
let stopping = false;
export function startGmailPullWorker(requestDrain: () => void) {
  if (stopping || worker) return;
  worker = createGmailPullWorker({ requestDrain });
  worker.start();
}
export async function stopGmailPullWorker() {
  stopping = true;
  await worker?.stop();
}
export function getGmailPullStatus() {
  return worker?.getStatus() ?? { state: "disabled" as const, lastMessageAt: null, lastErrorAt: null };
}
