import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { toggleCheckboxLine, makeTagCompletionSource, toggleMarkerWrap, linkInsertion, checkboxEnterAction, checkboxAutoConvert } from "./noteEditorExtensions.js";

// Apply toggleMarkerWrap to a doc + [anchor, head] selection, return [text, selFrom, selTo].
function applyWrap(doc, anchor, head, marker) {
  const state = EditorState.create({ doc, selection: { anchor, head } });
  const next = state.update(toggleMarkerWrap(state, marker)).state;
  const r = next.selection.main;
  return [next.doc.toString(), r.from, r.to];
}

describe("toggleMarkerWrap (B/I/E hotkeys)", () => {
  it("wraps a selection in the marker and keeps it selected", () => {
    expect(applyWrap("hello world", 0, 5, "**")).toEqual(["**hello** world", 2, 7]);
  });
  it("italic uses a single asterisk", () => {
    expect(applyWrap("hi", 0, 2, "*")).toEqual(["*hi*", 1, 3]);
  });
  it("inserts an empty pair and drops the caret inside when nothing is selected", () => {
    expect(applyWrap("ab", 1, 1, "**")).toEqual(["a****b", 3, 3]);
  });
  it("unwraps when markers hug the selection from outside", () => {
    // doc '**hello** world', select the inner 'hello' (offsets 2..7)
    expect(applyWrap("**hello** world", 2, 7, "**")).toEqual(["hello world", 0, 5]);
  });
  it("unwraps when the selection itself includes the markers", () => {
    // select '**hello**' (offsets 0..9)
    expect(applyWrap("**hello** world", 0, 9, "**")).toEqual(["hello world", 0, 5]);
  });
});

describe("checkboxEnterAction (Enter continues / exits a checkbox list)", () => {
  it("continues a non-empty checkbox with a fresh unchecked item", () => {
    expect(checkboxEnterAction("- [ ] buy milk")).toEqual({ type: "continue", insert: "\n- [ ] " });
  });
  it("a checked item still continues with an unchecked one", () => {
    expect(checkboxEnterAction("- [x] done")).toEqual({ type: "continue", insert: "\n- [ ] " });
  });
  it("preserves indentation when continuing", () => {
    expect(checkboxEnterAction("  - [ ] nested")).toEqual({ type: "continue", insert: "\n  - [ ] " });
  });
  it("exits the list on an empty checkbox", () => {
    expect(checkboxEnterAction("- [ ] ")).toEqual({ type: "exit" });
  });
  it("returns null for a non-checkbox line", () => {
    expect(checkboxEnterAction("just text")).toBeNull();
    expect(checkboxEnterAction("- a plain bullet")).toBeNull();
  });
});

describe("checkboxAutoConvert (`[ ]`/`[]` + space → `- [ ] `)", () => {
  it("converts a blank-bracket trigger", () => {
    expect(checkboxAutoConvert("[ ]")).toEqual({ prefix: "- [ ] " });
    expect(checkboxAutoConvert("[]")).toEqual({ prefix: "- [ ] " });
  });
  it("preserves leading indentation", () => {
    expect(checkboxAutoConvert("  [ ]")).toEqual({ prefix: "  - [ ] " });
  });
  it("does not convert mid-line or non-triggers", () => {
    expect(checkboxAutoConvert("foo [ ]")).toBeNull(); // not at line start
    expect(checkboxAutoConvert("[x]")).toBeNull();     // already-checked bracket is not the blank trigger
    expect(checkboxAutoConvert("[")).toBeNull();
  });
});

describe("linkInsertion (Cmd/Ctrl+K)", () => {
  it("empty selection inserts an empty pair, caret inside the []", () => {
    expect(linkInsertion("")).toEqual({ text: "[]()", caret: 1 });
  });
  it("a selected URL becomes [](url), caret in the label", () => {
    expect(linkInsertion("https://x.com")).toEqual({ text: "[](https://x.com)", caret: 1 });
  });
  it("selected text becomes [text](), caret inside the ()", () => {
    expect(linkInsertion("docs")).toEqual({ text: "[docs]()", caret: 7 });
  });
});

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
