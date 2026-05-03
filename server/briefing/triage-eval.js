import { readFile } from "fs/promises";
import { routeEmailForTriage } from "./triage-worker.js";

const VALID_LANES = new Set(["needs_attention", "fyi", "noise"]);
const VALID_URGENCIES = new Set(["high", "medium", "normal", "low"]);
const VALID_CATEGORIES = new Set([
  "finance",
  "security",
  "legal",
  "school",
  "personal",
  "work",
  "delivery",
  "updates",
  "marketing",
  "uncategorized",
]);

function normalizeLane(value) {
  if (value === "actionable") return "needs_attention";
  return VALID_LANES.has(value) ? value : null;
}

function normalizeCategory(value) {
  const normalized = String(value || "").toLowerCase().replace(/[^a-z0-9_]+/g, "_");
  return VALID_CATEGORIES.has(normalized) ? normalized : null;
}

function normalizeUrgency(value) {
  return VALID_URGENCIES.has(value) ? value : null;
}

function nonEmptyString(...values) {
  for (const value of values) {
    const text = String(value || "").trim();
    if (text) return text;
  }
  return "";
}

function isManuallyVerified(row) {
  return row.labels_verified === true
    || row.manual_label === true
    || row.manually_verified === true;
}

function rowsFromFixture(fixture) {
  if (Array.isArray(fixture)) return fixture;
  if (Array.isArray(fixture.examples)) return fixture.examples;
  if (Array.isArray(fixture.eval_seed)) return fixture.eval_seed;
  return [];
}

function expectedFromRow(row) {
  const lane = normalizeLane(row.expected_lane);
  if (!lane) return null;

  const expected = {
    lane,
    category: normalizeCategory(row.expected_category),
    urgency: normalizeUrgency(row.expected_urgency),
    escalation_badge: row.expected_escalation_badge || null,
    deadline_at: row.expected_deadline_at || null,
  };
  if (row.expected_escalation || row.expected_should_escalate) {
    expected.escalation_expected = true;
  }
  return expected;
}

function emailFromRow(row) {
  return {
    uid: row.email_id || row.uid || row.sample_id,
    user_id: row.user_id || "triage-eval-user",
    account_id: row.account_id || "triage-eval-account",
    account_label: row.account_label || "",
    account_email: row.account_email || "",
    from_name: nonEmptyString(row.from_name, row.sender_display, row.sender),
    from_address: row.from_address || "",
    subject: row.subject || "",
    body_snippet: nonEmptyString(row.body_snippet, row.snippet, row.summary),
    body_text: nonEmptyString(row.body_text, row.text, row.summary, row.action),
    email_date: row.email_date || row.briefing_generated_at || "",
    read: row.read ? 1 : 0,
  };
}

export function parseLabeledTriageExamples(fixture) {
  return rowsFromFixture(fixture)
    .filter((row) => isManuallyVerified(row))
    .map((row) => {
      const expected = expectedFromRow(row);
      if (!expected) return null;
      return {
        id: row.sample_id || row.email_id || row.uid,
        source: row.source || "manual_fixture",
        email: emailFromRow(row),
        expected,
        mock_model_outputs: row.mock_model_outputs || row.mockModelOutputs || {},
        notes: row.notes || "",
      };
    })
    .filter(Boolean);
}

function hasEscalation(decision = {}) {
  return Boolean(decision.escalation_badge || decision.escalation_expected);
}

function validateDecision(decision = {}) {
  const failures = [];
  if (!VALID_LANES.has(decision.lane)) failures.push("invalid_lane");
  if (!("category" in decision)) {
    failures.push("missing_category");
  } else if (decision.category != null && !VALID_CATEGORIES.has(decision.category)) {
    failures.push("invalid_category");
  }
  if (!("urgency" in decision)) {
    failures.push("missing_urgency");
  } else if (decision.urgency != null && !VALID_URGENCIES.has(decision.urgency)) {
    failures.push("invalid_urgency");
  }
  if (!("escalation_badge" in decision)) failures.push("missing_escalation_badge");
  if (!("deadline_at" in decision)) failures.push("missing_deadline_at");
  return failures;
}

function compareEvalResult(result) {
  const expected = result.expected || {};
  const actual = result.actual || {};
  const schemaFailures = validateDecision(actual);
  const problems = [];

  if (expected.lane === "needs_attention" && actual.lane !== "needs_attention") {
    problems.push("false_negative_needs_attention");
  }
  if (hasEscalation(expected) && !hasEscalation(actual)) {
    problems.push("false_negative_escalation");
  }
  if (!expected.deadline_at && actual.deadline_at) {
    problems.push("hallucinated_deadline");
  }
  if (expected.urgency && actual.urgency !== expected.urgency) {
    problems.push("incorrect_urgency");
  }
  if (expected.deadline_at && actual.deadline_at !== expected.deadline_at) {
    problems.push("deadline_mismatch");
  }
  if (expected.lane && actual.lane !== expected.lane && !problems.includes("false_negative_needs_attention")) {
    problems.push("lane_mismatch");
  }
  if (expected.category && actual.category !== expected.category) {
    problems.push("category_mismatch");
  }

  return { problems, schemaFailures };
}

function emptyStats() {
  return {
    total: 0,
    false_negative_needs_attention: 0,
    false_negative_escalation: 0,
    hallucinated_deadlines: 0,
    incorrect_urgency: 0,
    json_schema_stability_failures: 0,
    exact_lane_matches: 0,
    exact_category_matches: 0,
  };
}

export function buildTriageEvalReport(results) {
  const stats = emptyStats();
  const dangerous_misses = [];
  const mismatches = [];
  const schema_failures = [];

  for (const result of results) {
    stats.total += 1;
    const { problems, schemaFailures } = compareEvalResult(result);

    if (result.actual?.lane === result.expected?.lane) stats.exact_lane_matches += 1;
    if (result.expected?.category && result.actual?.category === result.expected.category) {
      stats.exact_category_matches += 1;
    }
    if (problems.includes("false_negative_needs_attention")) {
      stats.false_negative_needs_attention += 1;
    }
    if (problems.includes("false_negative_escalation")) {
      stats.false_negative_escalation += 1;
    }
    if (problems.includes("hallucinated_deadline")) {
      stats.hallucinated_deadlines += 1;
    }
    if (problems.includes("incorrect_urgency")) {
      stats.incorrect_urgency += 1;
    }
    if (schemaFailures.length) {
      stats.json_schema_stability_failures += 1;
      schema_failures.push({ id: result.id, failures: schemaFailures, actual: result.actual });
    }

    if (
      problems.includes("false_negative_needs_attention")
      || problems.includes("false_negative_escalation")
    ) {
      dangerous_misses.push({
        id: result.id,
        problems,
        expected: result.expected,
        actual: result.actual,
        modelCalls: result.modelCalls || [],
      });
    } else if (problems.length) {
      mismatches.push({
        id: result.id,
        problems,
        expected: result.expected,
        actual: result.actual,
        modelCalls: result.modelCalls || [],
      });
    }
  }

  return {
    dangerous_misses,
    stats,
    mismatches,
    schema_failures,
  };
}

function createNoRulesDbClient() {
  return {
    async execute() {
      return { rows: [] };
    },
  };
}

function mockDecisionForTier(example, tier) {
  return example.mock_model_outputs?.[tier]
    || example.mock_model_outputs?.default
    || {
      lane: "needs_attention",
      category: "uncategorized",
      urgency: "high",
      escalation_badge: "Needs Review",
      summary: "No mock model output supplied; review manually.",
      action: "Review",
      deadline_at: null,
      confidence: 0,
      bill_candidate: null,
    };
}

function createMockModelClient(example) {
  return {
    async classify({ tier }) {
      return {
        decision: mockDecisionForTier(example, tier),
        usage: { input_tokens: 0, output_tokens: 0 },
        estimated_cost_usd: 0,
        latency_ms: 0,
        provider: "mock",
        tier,
      };
    },
  };
}

export async function runTriageEval({
  fixturePath,
  useRealModels = false,
  dbClient = createNoRulesDbClient(),
} = {}) {
  if (!fixturePath) throw new Error("fixturePath is required");
  if (useRealModels && process.env.EA_TRIAGE_EVAL_REAL_MODELS !== "1") {
    throw new Error("Set EA_TRIAGE_EVAL_REAL_MODELS=1 to run real triage model calls");
  }

  const fixture = JSON.parse(await readFile(fixturePath, "utf8"));
  const examples = parseLabeledTriageExamples(fixture);
  const results = [];

  for (const example of examples) {
    const routed = await routeEmailForTriage(example.email, {
      dbClient,
      modelClient: useRealModels ? undefined : createMockModelClient(example),
    });
    results.push({
      id: example.id,
      expected: example.expected,
      actual: routed.decision,
      modelCalls: routed.modelCalls,
    });
  }

  return {
    fixturePath,
    labeled_examples: examples.length,
    ...buildTriageEvalReport(results),
  };
}
