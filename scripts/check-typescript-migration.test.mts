import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { checkTypescriptMigration } from "./check-typescript-migration.mts";

const fixtureRoots: string[] = [];

function writeFixtureFile(root: string, path: string, contents = "export {};\n") {
  const absolutePath = join(root, path);
  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, contents);
}

function createFixtureRepository() {
  const root = mkdtempSync(join(tmpdir(), "setpoint-typescript-migration-"));
  fixtureRoots.push(root);
  execFileSync("git", ["init", "--quiet"], { cwd: root });

  writeFixtureFile(root, ".gitignore", "ignored.js\n");
  writeFixtureFile(root, "src/legacy.js");
  writeFixtureFile(root, "src/typed.ts");
  writeFixtureFile(
    root,
    "scripts/typescript-migration-manifest.json",
    `${JSON.stringify({ remainingLegacyFiles: 1, typedScopes: ["src/typed.ts"] }, null, 2)}\n`,
  );
  execFileSync("git", ["add", "."], { cwd: root });
  writeFixtureFile(root, "src/ignored.js");

  return root;
}

afterEach(() => {
  for (const root of fixtureRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("checkTypescriptMigration", () => {
  it("accepts the exact tracked legacy count and ignores ignored files", () => {
    const result = checkTypescriptMigration({ cwd: createFixtureRepository() });

    expect(result).toEqual({ legacyFileCount: 1, legacyFiles: ["src/legacy.js"] });
  });

  it("reports the expected and actual legacy counts when the manifest drifts", () => {
    const root = createFixtureRepository();
    writeFixtureFile(
      root,
      "scripts/typescript-migration-manifest.json",
      `${JSON.stringify({ remainingLegacyFiles: 2, typedScopes: ["src/typed.ts"] }, null, 2)}\n`,
    );

    expect(() => checkTypescriptMigration({ cwd: root })).toThrow(
      "Legacy file count mismatch: manifest expects 2, found 1.\nTracked legacy files:\n  - src/legacy.js",
    );
  });

  it("rejects legacy files inside a completed typed scope", () => {
    const root = createFixtureRepository();
    writeFixtureFile(
      root,
      "scripts/typescript-migration-manifest.json",
      `${JSON.stringify({ remainingLegacyFiles: 1, typedScopes: ["src"] }, null, 2)}\n`,
    );

    expect(() => checkTypescriptMigration({ cwd: root })).toThrow(
      'Typed scope "src" contains legacy files:\n  - src/legacy.js',
    );
  });

  it("accepts a typed scope created in the current uncommitted child", () => {
    const root = createFixtureRepository();
    writeFixtureFile(root, "src/new-typed-file.ts");
    writeFixtureFile(
      root,
      "scripts/typescript-migration-manifest.json",
      `${JSON.stringify({ remainingLegacyFiles: 1, typedScopes: ["src/new-typed-file.ts"] }, null, 2)}\n`,
    );

    expect(checkTypescriptMigration({ cwd: root })).toEqual({
      legacyFileCount: 1,
      legacyFiles: ["src/legacy.js"],
    });
  });
});
