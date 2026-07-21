import { describe, expect, it } from "vitest";
import { parseRootKeyRotationArgs } from "./rotate-encryption-key.ts";

describe("root key rotation CLI arguments", () => {
  it("defaults to dry-run", () => {
    expect(parseRootKeyRotationArgs([])).toEqual({ apply: false });
  });

  it("requires an explicit offline confirmation for writes", () => {
    expect(() => parseRootKeyRotationArgs(["--apply"])).toThrow("--confirm-offline");
    expect(parseRootKeyRotationArgs(["--apply", "--confirm-offline"])).toEqual({ apply: true });
  });

  it("rejects unknown arguments", () => {
    expect(() => parseRootKeyRotationArgs(["--old-key=secret"])).toThrow("Unknown option");
  });
});
