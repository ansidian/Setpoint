import { describe, expect, it } from "vitest";
import {
  describeMimeAttachments,
  EMAIL_ATTACHMENT_MAX_BYTES,
  readMimeAttachment,
} from "./email-mime-attachments.ts";

describe("email MIME attachment policy", () => {
  it("assigns stable descriptors and separates inline parts", () => {
    expect(describeMimeAttachments([
      {
        partId: "2",
        filename: "report.pdf",
        contentType: "application/pdf",
        contentDisposition: "attachment",
        content: Buffer.from("pdf"),
        size: 3,
      },
      {
        partId: "3",
        filename: "logo.png",
        contentType: "image/png",
        contentDisposition: "inline",
        cid: "logo",
        content: Buffer.from("png"),
        size: 3,
      },
    ])).toEqual([
      expect.objectContaining({ id: "2", size: 3, inline: false }),
      expect.objectContaining({ id: "3", size: 3, inline: true }),
    ]);
  });

  it("rejects declared content beyond the decoded byte cap", () => {
    expect(() => readMimeAttachment([{
      partId: "2",
      filename: "oversized.zip",
      contentType: "application/zip",
      size: EMAIL_ATTACHMENT_MAX_BYTES + 1,
      content: Buffer.from("bounded-test-content"),
    }], "2")).toThrow(expect.objectContaining({ status: 413 }));
  });
});
