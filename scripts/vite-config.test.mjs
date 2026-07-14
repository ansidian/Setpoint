import { describe, expect, it } from "vitest";
import { manualChunks } from "../vite.config.js";

describe("manualChunks", () => {
  it.each([
    "/app/node_modules/@codemirror/view/dist/index.js",
    "/app/node_modules/@lezer/markdown/dist/index.js",
    "/app/node_modules/@marijn/find-cluster-break/src/index.js",
    "/app/node_modules/crelt/index.js",
    "/app/node_modules/style-mod/src/style-mod.js",
    "/app/node_modules/w3c-keyname/index.js",
  ])("routes the CodeMirror dependency graph into the bounded lazy vendor group", (id) => {
    expect(manualChunks(id)).toBe("codemirror-vendor");
  });

  it("leaves application modules to the default chunking strategy", () => {
    expect(manualChunks("/app/src/components/notes/NotesTab.jsx")).toBeUndefined();
  });
});
