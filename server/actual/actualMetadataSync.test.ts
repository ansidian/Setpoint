import { describe, expect, it, vi } from "vitest";
import {
  fetchActualBuffer,
  fetchActualJson,
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
