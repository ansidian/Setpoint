import "dotenv/config";
import { access } from "fs/promises";
import { resolve } from "path";
import { runTriageEval } from "../briefing/triage-eval.js";

const DEFAULT_FIXTURE = "docs/triage-redesign/labeled-triage-eval.json";

function usage() {
  return `Usage: node server/scripts/triage-eval.js [--fixture path] [--real-models] [--json]

Default fixture:
  ${DEFAULT_FIXTURE}

Default behavior uses deterministic mocked model outputs from the fixture.
Real model calls require both --real-models and EA_TRIAGE_EVAL_REAL_MODELS=1.`;
}

function parseArgs(argv) {
  const options = {
    fixturePath: DEFAULT_FIXTURE,
    useRealModels: false,
    json: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--fixture" || arg === "-f") {
      options.fixturePath = argv[index + 1];
      index += 1;
    } else if (arg.startsWith("--fixture=")) {
      options.fixturePath = arg.slice("--fixture=".length);
    } else if (arg === "--real-models") {
      options.useRealModels = true;
    } else if (arg === "--json") {
      options.json = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

function printTextReport(report) {
  console.log(`Triage eval fixture: ${report.fixturePath}`);
  console.log(`Labeled examples: ${report.labeled_examples}`);
  console.log("");

  console.log("Dangerous misses");
  if (!report.dangerous_misses.length) {
    console.log("  none");
  } else {
    for (const miss of report.dangerous_misses) {
      console.log(`  - ${miss.id}: ${miss.problems.join(", ")}`);
      console.log(`    expected ${miss.expected.lane}/${miss.expected.category || "any"}/${miss.expected.urgency || "any"}`);
      console.log(`    actual   ${miss.actual.lane}/${miss.actual.category || "unknown"}/${miss.actual.urgency || "unknown"}`);
      console.log(`    models   ${miss.modelCalls.length ? miss.modelCalls.join(" -> ") : "none"}`);
    }
  }
  console.log("");

  console.log("Stats");
  for (const [key, value] of Object.entries(report.stats)) {
    console.log(`  ${key}: ${value}`);
  }

  if (report.schema_failures.length) {
    console.log("");
    console.log("Schema failures");
    for (const failure of report.schema_failures) {
      console.log(`  - ${failure.id}: ${failure.failures.join(", ")}`);
    }
  }

  if (report.mismatches.length) {
    console.log("");
    console.log("Other mismatches");
    for (const mismatch of report.mismatches) {
      console.log(`  - ${mismatch.id}: ${mismatch.problems.join(", ")}`);
    }
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return 0;
  }

  const fixturePath = resolve(options.fixturePath);
  try {
    await access(fixturePath);
  } catch {
    throw new Error(`Missing labeled fixture: ${fixturePath}

Create it by copying selected rows from docs/triage-redesign/prod-triage-seed-candidates.json,
adding expected_* fields, and setting labels_verified: true after manual review.`);
  }

  const report = await runTriageEval({
    fixturePath,
    useRealModels: options.useRealModels,
  });

  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printTextReport(report);
  }

  return report.dangerous_misses.length || report.schema_failures.length ? 1 : 0;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err) => {
    console.error(err.message);
    console.error("");
    console.error(usage());
    process.exitCode = 1;
  });
