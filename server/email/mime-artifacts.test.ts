import { describe, expect, it } from "vitest";
import { looksLikeRawMime } from "./mime-artifacts.ts";

describe("looksLikeRawMime", () => {
  it("flags undecoded quoted-printable", () => {
    expect(looksLikeRawMime("Statement bal=\nance =E2=80=94 due =3D 07/07")).toBe(true);
  });
  it("flags MIME structural headers left in body text", () => {
    expect(looksLikeRawMime("Content-Transfer-Encoding: base64 Content-Type: multipart/alternative")).toBe(true);
    expect(looksLikeRawMime("--Apple-Mail=_ABC123 Content-Type: text/plain")).toBe(true);
  });
  it("flags long base64 runs", () => {
    expect(looksLikeRawMime("PGh0bWw+".repeat(40))).toBe(true);
  });
  it("passes clean prose, including a stray equals sign and short codes", () => {
    expect(looksLikeRawMime("Your statement balance is $238.80 = great news, due 07/07/2026")).toBe(false);
    expect(looksLikeRawMime("Promo code E2A9 applies")).toBe(false);
    expect(looksLikeRawMime("")).toBe(false);
  });
});
