import { describe, expect, it } from "vitest";
import { parseFrom } from "./email-index.ts";

describe("parseFrom", () => {
  it("prefers iCloud's separate from_email without touching the display name", () => {
    expect(parseFrom({ from: 'Jane Doe', from_email: "jane@icloud.com" }))
      .toEqual({ fromName: "Jane Doe", fromAddress: "jane@icloud.com" });
  });

  it("splits a plain display-name + angle-bracket address", () => {
    expect(parseFrom({ from: "Jane Doe <jane@example.com>" }))
      .toEqual({ fromName: "Jane Doe", fromAddress: "jane@example.com" });
  });

  it("strips a balanced surrounding quote pair from a quoted display name", () => {
    expect(parseFrom({ from: '"Doe, John" <john@example.com>' }))
      .toEqual({ fromName: "Doe, John", fromAddress: "john@example.com" });
    expect(parseFrom({ from: "'Doe, John' <john@example.com>" }))
      .toEqual({ fromName: "Doe, John", fromAddress: "john@example.com" });
  });

  it("keeps internal punctuation that is not a balanced quote pair", () => {
    // Apostrophe is not a wrapping pair, so it must survive intact.
    expect(parseFrom({ from: "O'Brien <obrien@example.com>" }))
      .toEqual({ fromName: "O'Brien", fromAddress: "obrien@example.com" });
    // A trailing inch mark is not balanced by a leading quote.
    expect(parseFrom({ from: 'Sized 5" <sales@example.com>' }))
      .toEqual({ fromName: 'Sized 5"', fromAddress: "sales@example.com" });
  });

  it("treats a bare email address as the address with no name", () => {
    expect(parseFrom({ from: "bare@example.com" }))
      .toEqual({ fromName: "", fromAddress: "bare@example.com" });
    expect(parseFrom({ from: "  spaced@example.com  " }))
      .toEqual({ fromName: "", fromAddress: "spaced@example.com" });
  });

  it("treats a name with no email shape as a name, not an address", () => {
    expect(parseFrom({ from: "Marketing Team" }))
      .toEqual({ fromName: "Marketing Team", fromAddress: "" });
  });

  it("does not promote a non-email angle-bracket token to from_address", () => {
    // Mangled header: the bracket content is not an address, so keep the whole
    // string as a display name instead of storing a malformed from_address.
    expect(parseFrom({ from: "Newsletter <not-an-address>" }))
      .toEqual({ fromName: "Newsletter <not-an-address>", fromAddress: "" });
  });

  it("handles an angle-bracket address with an empty display name", () => {
    expect(parseFrom({ from: "<solo@example.com>" }))
      .toEqual({ fromName: "", fromAddress: "solo@example.com" });
  });

  it("returns empty fields for an empty from header", () => {
    expect(parseFrom({ from: "" })).toEqual({ fromName: "", fromAddress: "" });
    expect(parseFrom({})).toEqual({ fromName: "", fromAddress: "" });
  });
});

