import { writeFileSync } from "fs";
import { join } from "path";
import { afterAll, describe, expect, it } from "vitest";
import { createTestTempDirSync, removeTempDirSync } from "../test-utils/temp-dir.ts";
import {
  loadDefaultPreflightRules
} from "./triage-preflight.ts";

const tempDir = createTestTempDirSync("triage-preflight-rules-");

afterAll(() => {
  removeTempDirSync(tempDir);
});

function writeCatalog(name: string, value: unknown) {
  const path = join(tempDir, name);
  writeFileSync(path, typeof value === "string" ? value : JSON.stringify(value));
  return path;
}

const validRule = {
  key: "rule_a",
  priority: 10,
  match_json: { mode: "finalize", subject_regex: "sale" },
  lane: "noise",
  category: "marketing",
};

describe("triage preflight rule catalog loader", () => {

  it("rejects a missing or unparsable catalog", () => {
    expect(() => loadDefaultPreflightRules(join(tempDir, "missing.json")))
      .toThrow(/Failed to load triage preflight rules/);
    expect(() => loadDefaultPreflightRules(writeCatalog("invalid.json", "{nope")))
      .toThrow(/Failed to load triage preflight rules/);
    expect(() => loadDefaultPreflightRules(writeCatalog("object.json", { rules: [] })))
      .toThrow(/must be an array/);
  });

  it("rejects rules without keys, with duplicate keys, or without match_json", () => {
    expect(() => loadDefaultPreflightRules(writeCatalog("no-key.json", [{ priority: 1 }])))
      .toThrow(/without a string key/);
    expect(() => loadDefaultPreflightRules(writeCatalog("dupe.json", [validRule, validRule])))
      .toThrow(/Duplicate triage preflight rule key "rule_a"/);
    expect(() => loadDefaultPreflightRules(
      writeCatalog("no-priority.json", [{ ...validRule, priority: "high" }]),
    )).toThrow(/non-numeric priority/);
    expect(() => loadDefaultPreflightRules(
      writeCatalog("no-match.json", [{ key: "rule_b", priority: 1 }]),
    )).toThrow(/no match_json object/);
  });

  it("rejects rules whose regex fields do not compile", () => {
    expect(() => loadDefaultPreflightRules(writeCatalog("bad-regex.json", [{
      ...validRule,
      match_json: { mode: "finalize", subject_regex: "([unclosed" },
    }]))).toThrow(/invalid subject_regex/);
  });
});
