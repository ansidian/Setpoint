import { describe, expect, it } from "vitest";
import { join } from "path";
import { sendProductionFrontendFallback } from "./static-assets.js";

function createResponse() {
  return {
    statusCode: 200,
    headers: {},
    body: undefined,
    sentFile: undefined,
    status(code) {
      this.statusCode = code;
      return this;
    },
    type(value) {
      this.headers["content-type"] = value;
      return this;
    },
    set(name, value) {
      this.headers[name.toLowerCase()] = value;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
    send(body) {
      this.body = body;
      return this;
    },
    sendFile(filePath) {
      this.sentFile = filePath;
      return this;
    },
  };
}

describe("production frontend static assets", () => {
  it("returns a real 404 for stale built asset URLs instead of the SPA HTML fallback", () => {
    const res = createResponse();

    sendProductionFrontendFallback({ path: "/assets/CalendarModal-stale.js" }, res, "/app/dist");

    expect(res.statusCode).toBe(404);
    expect(res.headers["content-type"]).toBe("text/plain");
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.body).toContain("Frontend asset not found");
    expect(res.sentFile).toBeUndefined();
  });

  it("serves the SPA index for client-side routes", () => {
    const res = createResponse();

    sendProductionFrontendFallback({ path: "/settings" }, res, "/app/dist");

    expect(res.statusCode).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-cache, must-revalidate");
    expect(res.sentFile).toBe(join("/app/dist", "index.html"));
  });
});
