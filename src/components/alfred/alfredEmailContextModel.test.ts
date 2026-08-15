import { describe, expect, it } from "vitest";
import type { AlfredPreparedEmailContext } from "../../../shared/types/alfred";
import { emailAttachmentPreviewItem, pendingEmailAttachment } from "./alfredEmailContextModel";

describe("alfredEmailContextModel", () => {
  it("preserves the receiving account for shared remote-image trust after preparation", () => {
    const prepared: AlfredPreparedEmailContext = {
      contextId: "ctx-mail-a",
      uid: "mail-a",
      subject: "Email A",
      sender: {
        name: "Alice",
        address: "alice@example.com",
        display: "Alice <alice@example.com>",
      },
      timestamp: "2026-08-14T18:00:00Z",
      charCount: 120,
    };

    const attachment = pendingEmailAttachment({
      key: "mail-a",
      source: {
        uid: "mail-a",
        accountId: "gmail-work",
        subject: "Email A",
        senderName: "Alice",
        senderAddress: "alice@example.com",
        timestamp: "2026-08-14T18:00:00Z",
      },
      status: "ready",
      prepared,
      error: null,
    });

    expect(emailAttachmentPreviewItem(attachment).account).toEqual({ id: "gmail-work" });
  });
});
