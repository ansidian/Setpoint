import { describe, expect, it } from "vitest";
import { decodeGmailPubSubNotification } from "./gmailPubSubNotification.js";

describe("decodeGmailPubSubNotification", () => {
  it("normalizes emailAddress and shapes the payload", () => {
    const body = {
      message: {
        data: Buffer.from(JSON.stringify({ emailAddress: "Work@Example.com", historyId: "42" })).toString("base64url"),
        messageId: "m1",
        publishTime: "t",
      },
      subscription: "s",
    };
    expect(decodeGmailPubSubNotification(body)).toEqual({
      emailAddress: "work@example.com",
      historyId: "42",
      pubsubMessageId: "m1",
      publishTime: "t",
      subscription: "s",
    });
  });

  it("throws when emailAddress or historyId is missing", () => {
    expect(() =>
      decodeGmailPubSubNotification({ message: { data: Buffer.from("{}").toString("base64url") } }),
    ).toThrow("requires emailAddress and historyId");
  });

  it("throws on missing message.data", () => {
    expect(() => decodeGmailPubSubNotification({ message: {} })).toThrow("message.data is required");
  });
});
