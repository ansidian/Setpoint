import { describe, expect, it, vi } from "vitest";
import {
  MessageEnvelopeSchema,
  MessageSchema,
  SyncRequestSchema,
  SyncResponseSchema,
  Timestamp,
  create,
  fromBinary,
  makeClientId,
  toBinary,
} from "@actual-app/crdt";
import {
  decodeSyncResponse,
  deserializeSyncValue,
  encodeSyncRequest,
  fetchActualBuffer,
  fetchActualJson,
  messageInsertQuery,
  quoteIdent,
  readBoundedResponseBody,
} from "./actualMetadataSync.ts";

describe("readBoundedResponseBody", () => {
  it("rejects a streamed response as soon as it crosses the byte limit", async () => {
    const response = new Response(new Uint8Array([1, 2, 3, 4, 5]));

    await expect(readBoundedResponseBody(response, 4)).rejects.toThrow(/download exceeded/);
  });

  it("rejects an oversized declared content length before reading the body", async () => {
    const response = new Response(new Uint8Array([1]), {
      headers: { "Content-Length": "100" },
    });

    await expect(readBoundedResponseBody(response, 4)).rejects.toThrow(/download exceeded/);
  });

  it("also bounds error responses from file downloads", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(new Uint8Array(65_537), {
      status: 502,
    })));
    try {
      await expect(fetchActualBuffer("https://actual.example/file", {
        token: "token",
        fileId: "file-id",
      })).rejects.toThrow(/download exceeded/);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("bounds JSON responses from the remote Actual server", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(new Uint8Array(2 * 1024 * 1024 + 1))));
    try {
      await expect(fetchActualJson("https://actual.example/file-list")).rejects.toThrow(/download exceeded/);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("deserializeSyncValue", () => {
  it("decodes the Actual sync value type prefixes", () => {
    expect(deserializeSyncValue("0:")).toBeNull();
    expect(deserializeSyncValue("N:-1888")).toBe(-1888);
    expect(deserializeSyncValue("N:122.34")).toBe(122.34);
    expect(deserializeSyncValue("S:payee-1")).toBe("payee-1");
  });

  it("throws on an unrecognized prefix", () => {
    expect(() => deserializeSyncValue("X:bad")).toThrow(/Invalid Actual sync value/);
  });
});

describe("quoteIdent", () => {
  it("double-quotes a valid SQL identifier", () => {
    expect(quoteIdent("transactions")).toBe('"transactions"');
    expect(quoteIdent("_conditions")).toBe('"_conditions"');
  });

  it("rejects identifiers that could carry an injection", () => {
    expect(() => quoteIdent("a-b")).toThrow(/Invalid Actual DB identifier/);
    expect(() => quoteIdent("1abc")).toThrow(/Invalid Actual DB identifier/);
    expect(() => quoteIdent("drop table; --")).toThrow(/Invalid Actual DB identifier/);
  });
});

describe("messageInsertQuery", () => {
  it("builds an INSERT OR IGNORE row keyed by the stringified timestamp", () => {
    const query = messageInsertQuery({
      timestamp: new Timestamp(2000, 0, makeClientId()),
      dataset: "transactions",
      row: "txn-1",
      column: "amount",
      value: "N:-1888",
    });
    expect(query.sql).toContain("INSERT OR IGNORE INTO messages_crdt");
    expect(query.args[0]).toBe(String(query.args[0]));
    expect(query.args.slice(1)).toEqual(["transactions", "txn-1", "amount", "N:-1888"]);
  });
});

describe("encodeSyncRequest", () => {
  it("encodes a protobuf sync request with the cloud file id and since", () => {
    const encoded = encodeSyncRequest({ groupId: "sync-123", cloudFileId: "file-1", since: "ts-1" });
    const decoded = fromBinary(SyncRequestSchema, encoded);
    expect(decoded.groupId).toBe("sync-123");
    expect(decoded.fileId).toBe("file-1");
    expect(decoded.since).toBe("ts-1");
  });
});

describe("decodeSyncResponse", () => {
  interface TestSyncMessage {
    timestamp: Timestamp;
    dataset: string;
    row: string;
    column: string;
    value: string;
    isEncrypted?: boolean;
  }

  function responseBuffer(messages: TestSyncMessage[], { merkle = JSON.stringify({}) }: { merkle?: string } = {}): Uint8Array {
    const response = create(SyncResponseSchema, {
      merkle,
      messages: messages.map((message) => create(MessageEnvelopeSchema, {
        timestamp: String(message.timestamp),
        isEncrypted: message.isEncrypted ?? false,
        content: toBinary(MessageSchema, create(MessageSchema, {
          dataset: message.dataset,
          row: message.row,
          column: message.column,
          value: message.value,
        })),
      })),
    });
    return toBinary(SyncResponseSchema, response);
  }

  it("decodes envelopes into messages with the deserialized raw value and parsed merkle", () => {
    const timestamp = new Timestamp(2000, 0, makeClientId());
    const buffer = responseBuffer([
      { timestamp, dataset: "transactions", row: "txn-remote", column: "amount", value: "N:-1888" },
    ], { merkle: JSON.stringify({ hash: 7 }) });

    const decoded = decodeSyncResponse(buffer);

    expect(decoded.merkle).toEqual({ hash: 7 });
    expect(decoded.messages).toHaveLength(1);
    expect(decoded.messages[0]).toMatchObject({
      dataset: "transactions",
      row: "txn-remote",
      column: "amount",
      value: "N:-1888",
      rawValue: -1888,
    });
    expect(String(decoded.messages[0]!.timestamp)).toBe(String(timestamp));
  });

  it("rejects encrypted sync messages with a 400", () => {
    const buffer = responseBuffer([
      { timestamp: new Timestamp(2000, 0, makeClientId()), dataset: "transactions", row: "r", column: "c", value: "S:x", isEncrypted: true },
    ]);
    expect(() => decodeSyncResponse(buffer)).toThrow(/Encrypted Actual sync messages are not supported/);
  });

  it("returns a null merkle when the response carries no merkle text", () => {
    const buffer = responseBuffer([], { merkle: "" });
    expect(decodeSyncResponse(buffer)).toEqual({ messages: [], merkle: null });
  });
});
