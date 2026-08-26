import { describe, expect, it } from "vitest";
import {
  emailAttachmentName,
  emailAttachmentPreviewKind,
  formatAttachmentSize,
  visibleEmailAttachments,
} from "./emailAttachmentModel";

describe("email attachment model", () => {
  it("hides related inline parts without hiding ordinary files", () => {
    expect(visibleEmailAttachments([
      { id: "1", filename: "signature.png", contentType: "image/png", inline: true },
      { id: "2", filename: "report.pdf", contentType: "application/pdf", inline: false },
    ]).map((attachment) => attachment.id)).toEqual(["2"]);
  });

  it("previews only PDF and common raster-image MIME types", () => {
    expect(emailAttachmentPreviewKind("application/pdf")).toBe("pdf");
    expect(emailAttachmentPreviewKind("image/jpeg")).toBe("image");
    expect(emailAttachmentPreviewKind("image/svg+xml")).toBeNull();
    expect(emailAttachmentPreviewKind("text/html")).toBeNull();
    expect(emailAttachmentPreviewKind("application/vnd.openxmlformats-officedocument.wordprocessingml.document")).toBeNull();
  });

  it("formats bounded display names and byte sizes", () => {
    expect(emailAttachmentName({ id: "1", filename: null, inline: false })).toBe("Untitled attachment");
    expect(formatAttachmentSize(0)).toBe("0 B");
    expect(formatAttachmentSize(1536)).toBe("1.5 KB");
    expect(formatAttachmentSize(5 * 1024 * 1024)).toBe("5.0 MB");
    expect(formatAttachmentSize(null)).toBe("Unknown size");
  });
});
