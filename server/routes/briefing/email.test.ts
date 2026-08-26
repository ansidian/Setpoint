import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "../../test-utils/supertest.ts";

const getEmailAttachment = vi.fn();

// test-architecture: allow-boundary-mock -- The route test controls the provider-backed attachment service boundary while verifying HTTP validation and binary response contracts.
vi.mock("../../email/email-service.ts", () => ({
  getEmailAttachment,
}));

process.env.EA_USER_ID = "user-1";
const router = (await import("./email.ts")).default;

function makeApp() {
  const app = express();
  app.use("/api/briefing", router);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("email attachment route", () => {
  it("streams a bounded attachment with safe private download headers", async () => {
    getEmailAttachment.mockResolvedValue({
      content: Buffer.from("attachment-bytes"),
      filename: "../Quarterly résumé.pdf",
      contentType: "application/pdf",
      size: Buffer.byteLength("attachment-bytes"),
    });

    const response = await request(makeApp())
      .get("/api/briefing/email/gmail-work-message/attachments/2");

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toMatch(/^application\/pdf/);
    expect(response.headers["content-disposition"]).toContain("attachment;");
    expect(response.headers["content-disposition"]).not.toContain("../");
    expect(response.headers["cache-control"]).toBe("private, no-store, no-transform");
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    // test-architecture: allow-boundary-interaction -- Attachment retrieval is the provider boundary; the route must pass the authenticated owner and exact message/part identity.
    expect(getEmailAttachment).toHaveBeenCalledWith("user-1", "gmail-work-message", "2");
  });

  it("rejects invalid part locators before reaching the provider", async () => {
    const response = await request(makeApp())
      .get("/api/briefing/email/gmail-work-message/attachments/not-a-part");

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ message: "Invalid attachment id" });
    // test-architecture: allow-boundary-interaction -- Invalid locators must be rejected before any outbound provider attachment read.
    expect(getEmailAttachment).not.toHaveBeenCalled();
  });

  it("preserves bounded client errors and hides provider failure details", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    getEmailAttachment.mockRejectedValueOnce(Object.assign(new Error("Attachment not found"), { status: 404 }));
    const missing = await request(makeApp())
      .get("/api/briefing/email/gmail-work-message/attachments/2");
    expect(missing.status).toBe(404);
    expect(missing.body).toEqual({ message: "Attachment not found" });

    getEmailAttachment.mockRejectedValueOnce(new Error("provider token secret"));
    const failed = await request(makeApp())
      .get("/api/briefing/email/gmail-work-message/attachments/2");
    expect(failed.status).toBe(502);
    expect(failed.body).toEqual({ message: "Attachment download failed" });
    // test-architecture: allow-boundary-interaction -- Provider failures cross the process logging boundary; the route must emit only a content-free operational signal.
    expect(errorSpy).toHaveBeenCalledWith("Error fetching email attachment");
    errorSpy.mockRestore();
  });
});
