import { readFile, stat } from "node:fs/promises";
import type { FinancialProviderEmailSource } from "../../shared/types/financial-parsers.ts";
import { replayFinancialProviderSources } from "../financial-parsers/replay-report.ts";

function isSource(value: unknown): value is FinancialProviderEmailSource {
  if (!value || typeof value !== "object") return false;
  const source = value as Record<string, unknown>;
  return ["fromAddress", "subject", "body"].every(key => typeof source[key] === "string")
    && (source.emailDate == null || typeof source.emailDate === "string")
    && (source.attachments === undefined || (Array.isArray(source.attachments) && source.attachments.every(attachment =>
      attachment && typeof attachment.filename === "string" && typeof attachment.text === "string")));
}

async function main() {
  const [file, ...extra] = process.argv.slice(2);
  if (!file || extra.length) throw new Error("Usage: npm run financial-provider:replay -- <sources.json>");
  if ((await stat(file)).size > 64 * 1024 * 1024) throw new Error("Replay input exceeds 64 MiB.");
  const input: unknown = JSON.parse(await readFile(file, "utf8"));
  if (!Array.isArray(input) || input.length > 10_000) throw new Error("Expected an array of at most 10,000 sources or { source } fixtures.");
  const sources = input.map((value: unknown, index) => {
    const source = value && typeof value === "object" && "source" in value ? value.source : value;
    if (!isSource(source)) throw new Error(`Invalid source at row ${index + 1}.`);
    return source;
  });
  console.log(JSON.stringify(replayFinancialProviderSources(sources), null, 2));
}

main().catch(() => {
  // Input parsing errors can quote private source text. Keep CLI failures redacted.
  console.error("Replay failed. Supply one JSON file (at most 64 MiB / 10,000 rows) containing complete fromAddress, subject and body source fields.");
  process.exitCode = 1;
});
