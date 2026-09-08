import { afterEach, describe, expect, it, vi } from "vitest";
import { createClientId } from "./clientId";

describe("browser request UUIDs", () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each([
    [0, "00000000-0000-4000-8000-000000000000"],
    [255, "ffffffff-ffff-4fff-bfff-ffffffffffff"],
  ])("preserves random bytes and UUID version/variant without randomUUID (%i)", (byte, expected) => {
    vi.stubGlobal("crypto", { getRandomValues: (bytes: Uint8Array) => bytes.fill(byte) });
    expect(createClientId()).toBe(expected);
  });

  it("uses native UUIDs when available", () => {
    const id = "e0102578-9d0d-46a2-a6df-a3a9c2df8b98";
    vi.stubGlobal("crypto", { randomUUID: () => id });
    expect(createClientId()).toBe(id);
  });
});
