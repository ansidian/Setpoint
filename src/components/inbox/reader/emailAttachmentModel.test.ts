import { describe, expect, it } from "vitest";
import {
  emailAttachmentPreviewKind,
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
    expect(emailAttachmentPreviewKind("text/csv; charset=utf-8")).toBe("csv");
    expect(emailAttachmentPreviewKind("image/svg+xml")).toBeNull();
    expect(emailAttachmentPreviewKind("text/html")).toBeNull();
    expect(emailAttachmentPreviewKind("application/vnd.openxmlformats-officedocument.wordprocessingml.document")).toBeNull();
  });
});
