import { readFile } from "fs/promises";
import { resolve } from "path";
import { evaluateTriagePreflight, DEFAULT_PREFLIGHT_RULES } from "../triage/triage-preflight.js";

const DEFAULT_FIXTURE = "docs/triage-redesign/prod-triage-seed-candidates.json";
const DEFAULT_BASELINE_DISABLED_PROFILE_GROUPS = [
  ...new Set(DEFAULT_PREFLIGHT_RULES.map((rule) => rule.profile_group).filter(Boolean)),
];

function usage() {
  return `Usage: node server/scripts/triage-preflight-dry-run.js [--fixture path] [--email-interest value] [--json]

Evaluates local email seed rows against deterministic preflight rules only.
Does not mutate triage rows, jobs, snapshots, or call models.`;
}

function parseArgs(argv) {
  const options = { fixturePath: DEFAULT_FIXTURE, json: false, help: false, emailInterests: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--fixture" || arg === "-f") {
      options.fixturePath = argv[index + 1];
      index += 1;
    } else if (arg.startsWith("--fixture=")) {
      options.fixturePath = arg.slice("--fixture=".length);
    } else if (arg === "--json") {
      options.json = true;
    } else if (arg === "--email-interest") {
      options.emailInterests.push(argv[index + 1]);
      index += 1;
    } else if (arg.startsWith("--email-interest=")) {
      options.emailInterests.push(arg.slice("--email-interest=".length));
    } else if (arg === "--email-interests") {
      options.emailInterests.push(...String(argv[index + 1] || "").split(","));
      index += 1;
    } else if (arg.startsWith("--email-interests=")) {
      options.emailInterests.push(...arg.slice("--email-interests=".length).split(","));
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  options.emailInterests = options.emailInterests
    .map((interest) => String(interest || "").trim())
    .filter(Boolean);
  return options;
}

function rowsFromFixture(fixture) {
  if (Array.isArray(fixture)) return fixture;
  if (Array.isArray(fixture.examples)) return fixture.examples;
  if (Array.isArray(fixture.eval_seed)) return fixture.eval_seed;
  return [];
}

function nonEmptyString(...values) {
  for (const value of values) {
    const text = String(value || "").trim();
    if (text) return text;
  }
  return "";
}

function emailFromRow(row, index) {
  return {
    uid: row.email_id || row.uid || row.sample_id || `row-${index + 1}`,
    user_id: row.user_id || "triage-dry-run-user",
    account_id: row.account_id || "triage-dry-run-account",
    account_label: row.account_label || "",
    account_email: row.account_email || "",
    from_name: nonEmptyString(row.from_name, row.sender_display, row.sender),
    from_address: row.from_address || (row.sender_domain ? `unknown@${row.sender_domain}` : ""),
    subject: row.subject || "",
    body_snippet: nonEmptyString(row.body_snippet, row.snippet, row.summary),
    body_text: nonEmptyString(row.body_text, row.text, row.summary, row.action),
    email_date: row.email_date || row.briefing_generated_at || "",
    read: row.read ? 1 : 0,
  };
}

function summarize(results) {
  const byAction = new Map();
  const byReason = new Map();
  const byInterest = new Map();
  for (const result of results) {
    byAction.set(result.action, (byAction.get(result.action) || 0) + 1);
    byReason.set(result.reasonCode, (byReason.get(result.reasonCode) || 0) + 1);
    if (result.interestPromotion) {
      byInterest.set(result.matchedInterest, (byInterest.get(result.matchedInterest) || 0) + 1);
    }
  }
  return {
    total: results.length,
    byAction: Object.fromEntries([...byAction.entries()].sort()),
    byReason: Object.fromEntries([...byReason.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))),
    interestPromotions: {
      total: results.filter((result) => result.interestPromotion).length,
      byInterest: Object.fromEntries([...byInterest.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))),
    },
  };
}

function diffCounts(current = {}, baseline = {}) {
  const keys = new Set([...Object.keys(current), ...Object.keys(baseline)]);
  return Object.fromEntries([...keys].sort().map((key) => [key, (current[key] || 0) - (baseline[key] || 0)]));
}

function summarizeDeltas(currentSummary, baselineSummary) {
  return {
    byAction: diffCounts(currentSummary.byAction, baselineSummary.byAction),
    byReason: diffCounts(currentSummary.byReason, baselineSummary.byReason),
    interestPromotions: {
      total: currentSummary.interestPromotions.total - baselineSummary.interestPromotions.total,
      byInterest: diffCounts(
        currentSummary.interestPromotions.byInterest,
        baselineSummary.interestPromotions.byInterest,
      ),
    },
  };
}

function resultFromPreflight(email, result) {
  return {
    id: email.uid,
    subject: email.subject,
    from: email.from_name || email.from_address,
    action: result.action,
    lane: result.lane,
    category: result.category,
    modelTier: result.modelTier,
    reasonCode: result.reasonCode,
    matchedRuleKey: result.matchedRuleKey,
    riskOverride: result.riskOverride,
    matchedInterest: result.matchedInterest,
    interestPromotion: result.interestPromotion,
    metadata: result.metadata,
  };
}

function rowChange(current, baseline) {
  const changed = current.action !== baseline.action
    || current.lane !== baseline.lane
    || current.reasonCode !== baseline.reasonCode
    || current.matchedRuleKey !== baseline.matchedRuleKey;
  if (!changed) return null;
  return {
    from: {
      action: baseline.action,
      lane: baseline.lane,
      reasonCode: baseline.reasonCode,
      matchedRuleKey: baseline.matchedRuleKey,
    },
    to: {
      action: current.action,
      lane: current.lane,
      reasonCode: current.reasonCode,
      matchedRuleKey: current.matchedRuleKey,
    },
  };
}

function printText(report) {
  console.log(`Preflight dry run fixture: ${report.fixturePath}`);
  console.log(`Rows: ${report.summary.total}`);
  console.log(`Changed from baseline: ${report.changedFromBaseline}`);
  console.log("");
  console.log("By action");
  for (const [action, count] of Object.entries(report.summary.byAction)) {
    const delta = report.deltaFromBaseline.byAction[action] || 0;
    console.log(`  ${action}: ${count}${delta ? ` (${delta > 0 ? "+" : ""}${delta})` : ""}`);
  }
  console.log("");
  console.log("Top reasons");
  for (const [reason, count] of Object.entries(report.summary.byReason).slice(0, 12)) {
    console.log(`  ${reason}: ${count}`);
  }
  console.log("");
  console.log("Interest promotions");
  console.log(`  total: ${report.summary.interestPromotions.total}`);
  for (const [interest, count] of Object.entries(report.summary.interestPromotions.byInterest)) {
    console.log(`  ${interest}: ${count}`);
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }
  const fixturePath = resolve(options.fixturePath);
  const fixture = JSON.parse(await readFile(fixturePath, "utf8"));
  const evaluated = rowsFromFixture(fixture).map((row, index) => {
    const email = emailFromRow(row, index);
    const current = resultFromPreflight(email, evaluateTriagePreflight(email, {
      emailInterests: options.emailInterests,
    }));
    const baseline = resultFromPreflight(email, evaluateTriagePreflight(email, {
      emailInterests: options.emailInterests,
      disabledProfileGroups: DEFAULT_BASELINE_DISABLED_PROFILE_GROUPS,
    }));
    return {
      ...current,
      baseline,
      changeFromBaseline: rowChange(current, baseline),
    };
  });
  const summary = summarize(evaluated);
  const baselineSummary = summarize(evaluated.map((result) => result.baseline));
  const report = {
    fixturePath,
    emailInterests: options.emailInterests,
    summary,
    baselineSummary,
    deltaFromBaseline: summarizeDeltas(summary, baselineSummary),
    changedFromBaseline: evaluated.filter((result) => result.changeFromBaseline).length,
    results: evaluated,
  };
  if (options.json) console.log(JSON.stringify(report, null, 2));
  else printText(report);
}

main().catch((err) => {
  console.error(err.message);
  process.exitCode = 1;
});
