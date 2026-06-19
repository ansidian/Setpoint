import { describe, expect, it } from "vitest";
import { toggleCheckboxLine, makeTagCompletionSource } from "./noteEditorExtensions.js";

describe("toggleCheckboxLine", () => {
  it("checks an unchecked box by index", () => {
    expect(toggleCheckboxLine("- [ ] a\n- [ ] b", 1)).toBe("- [ ] a\n- [x] b");
  });
  it("unchecks a checked box", () => {
    expect(toggleCheckboxLine("- [x] a", 0)).toBe("- [ ] a");
  });
});

describe("makeTagCompletionSource", () => {
  const source = makeTagCompletionSource(() => ["home", "home-office", "ideas"]);
  const ctxFor = (text) => ({
    explicit: false,
    matchBefore: (re) => {
      const m = text.match(re);
      return m ? { from: text.length - m[0].length, to: text.length, text: m[0] } : null;
    },
  });
  it("returns tag options matching the typed #prefix", () => {
    const res = source(ctxFor("plan #hom"));
    expect(res.options.map((o) => o.label)).toEqual(["#home", "#home-office"]);
  });
  it("returns null when not in a #token", () => {
    expect(source(ctxFor("plain text"))).toBeNull();
  });
});
