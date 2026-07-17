import {
  MessageEnvelopeSchema,
  MessageSchema,
  SyncRequestSchema,
  create,
  fromBinary,
  toBinary,
} from "@actual-app/crdt";

export interface ActualSyncMessage {
  timestamp: { toString(): string };
  dataset: string;
  row: string;
  column: string;
  value: string;
  rawValue?: unknown;
}

export interface SyncRequestInput {
  groupId: string;
  cloudFileId: string;
  since: string | { toString(): string };
  messages: ActualSyncMessage[];
}

export function serializeValue(value: unknown): string {
  if (value === null) return "0:";
  if (typeof value === "number") return `N:${value}`;
  if (typeof value === "string") return `S:${value}`;
  throw new Error(`Unserializable Actual value: ${JSON.stringify(value)}`);
}

export function encodeSyncRequest({ groupId, cloudFileId, since, messages }: SyncRequestInput): Uint8Array {
  const requestPb = create(SyncRequestSchema, {
    messages: messages.map((message) => create(MessageEnvelopeSchema, {
      timestamp: String(message.timestamp),
      isEncrypted: false,
      content: toBinary(MessageSchema, create(MessageSchema, {
        dataset: message.dataset,
        row: message.row,
        column: message.column,
        value: message.value,
      })),
    })),
    groupId,
    fileId: cloudFileId,
    since: String(since),
  });
  return toBinary(SyncRequestSchema, requestPb);
}

export function syncPayloadSummary(messages: Array<Pick<ActualSyncMessage, "dataset">>): Record<string, number> {
  const datasets: Record<string, number> = {};
  for (const message of messages) {
    datasets[message.dataset] = (datasets[message.dataset] || 0) + 1;
  }
  return datasets;
}

// The sync payload is hand-assembled protobuf; a silent @actual-app/crdt wire
// format change would corrupt writes without an error. Decode the encoded
// request and compare it field-by-field against the input so drift fails loudly
// before anything is sent.
export function verifyEncodedSyncRequest(buffer: Uint8Array, { groupId, cloudFileId, since, messages }: SyncRequestInput): void {
  const decoded = fromBinary(SyncRequestSchema, buffer);
  const problems: string[] = [];
  if (decoded.groupId !== groupId) problems.push("groupId");
  if (decoded.fileId !== cloudFileId) problems.push("fileId");
  if (decoded.since !== String(since)) problems.push("since");
  const envelopes = decoded.messages;
  if (envelopes.length !== messages.length) {
    problems.push(`messageCount (${envelopes.length} != ${messages.length})`);
  } else {
    envelopes.forEach((envelope: { timestamp: string; content: Uint8Array }, index: number) => {
      const expected = messages[index];
      const content = fromBinary(MessageSchema, envelope.content);
      if (!expected) {
        problems.push(`message[${index}] (missing expected input)`);
        return;
      }
      if (
        envelope.timestamp !== String(expected.timestamp)
        || content.dataset !== expected.dataset
        || content.row !== expected.row
        || content.column !== expected.column
        || content.value !== expected.value
      ) {
        problems.push(`message[${index}] (${expected.dataset}.${expected.column})`);
      }
    });
  }
  if (problems.length) {
    throw Object.assign(
      new Error(`Actual lightweight sync payload failed its encode self-check (${problems.join(", ")}); the @actual-app/crdt wire format may have drifted`),
      { status: 500, code: "ACTUAL_LIGHTWEIGHT_PAYLOAD_DRIFT" },
    );
  }
}
