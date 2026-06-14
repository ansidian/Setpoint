import { readFile } from "fs/promises";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./triage-heuristic-scorer.js", () => ({
  heuristicNoModelDecision: vi.fn(() => ({ lane: "fyi", triage_source: "no_model_heuristic" })),
}));

import { heuristicNoModelDecision } from "./triage-heuristic-scorer.js";
import { resolveEffectiveEmailTriageMode } from "./triage-mode.js";

// Resolve sibling source files from this test's own directory (repo convention; see
// server/db/migrations.test.js). fileURLToPath uses node's url module directly, so it
// avoids the happy-dom global URL — which rejects new URL(..., import.meta.url) passed
// to fs.readFile with "The URL must be of scheme file".
const TEST_DIR = dirname(fileURLToPath(import.meta.url));

describe("no_model branch routes through the heuristic scorer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("dev (auto) resolves to no_model, the mode the scorer is gated behind", () => {
    // The scorer must only ever be reachable from the no_model branch.
    expect(resolveEffectiveEmailTriageMode("auto", { nodeEnv: "development" })).toBe("no_model");
    // In prod, auto -> real: the scorer branch is not taken at all.
    expect(resolveEffectiveEmailTriageMode("auto", { nodeEnv: "production" })).toBe("real");
  });

  it("worker source wires heuristicNoModelDecision into the no_model branch (not noModelDecision)", async () => {
    const src = await readFile(join(TEST_DIR, "triage-worker.js"), "utf8");

    // Source-text guard: fails if the no_model branch ever reverts to noModelDecision(email).
    // Intentionally brittle to a reformat of the branch, but cheap and exact for this regression.
    const branch = src.slice(src.indexOf('=== "no_model"'));
    const branchBody = branch.slice(0, branch.indexOf("} else {"));
    expect(branchBody).toContain("heuristicNoModelDecision(email)");
    expect(branchBody).not.toContain("noModelDecision(email)");
    expect(src).toContain('import { heuristicNoModelDecision } from "./triage-heuristic-scorer.js"');
  });

  it("the mocked scorer is callable and returns a no_model_heuristic decision", () => {
    const decision = heuristicNoModelDecision({ subject: "x" });
    expect(decision.triage_source).toBe("no_model_heuristic");
    expect(heuristicNoModelDecision).toHaveBeenCalledTimes(1);
  });
});
