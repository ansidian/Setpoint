import { readFile } from "fs/promises";
import { routeEmailForTriage } from "./triage-worker.ts";
import type {
  TriageDb,
  TriageEmail,
  TriageLane,
  TriageModelClient,
  TriageModelTier,
  TriagePreflightAction,
  TriageUrgency,
} from "./triage-types.ts";

interface TriageEvalExpected extends Record<string, unknown> {
  lane: TriageLane;
  category: string | null;
  urgency: TriageUrgency | null;
  escalation_badge: unknown;
  deadline_at: unknown;
  escalation_expected?: true;
  preflight_action?: TriagePreflightAction;
  reason_code?: string;
}

interface TriageEvalRow extends Record<string, unknown> {
  labels_verified?: boolean;
  manual_label?: boolean;
  manually_verified?: boolean;
  mock_model_outputs?: Record<string, unknown>;
  mockModelOutputs?: Record<string, unknown>;
}

interface TriageEvalExample {
  id: unknown;
  source: unknown;
  email: TriageEmail;
  expected: TriageEvalExpected;
  mock_model_outputs: Record<string, unknown>;
  notes: unknown;
}

interface TriageEvalResult {
  id: unknown;
  expected: Partial<TriageEvalExpected>;
  actual: Record<string, unknown>;
  modelCalls?: TriageModelTier[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

const VALID_LANES = new Set(["needs_attention", "fyi", "noise"]);
const VALID_URGENCIES = new Set(["high", "medium", "normal", "low"]);
const VALID_PREFLIGHT_ACTIONS = new Set(["finalize", "audit", "grace", "route_model"]);
const VALID_CATEGORIES = new Set([
  "finance",
  "security",
  "legal",
  "school",
  "personal",
  "work",
  "delivery",
  "infra",
  "updates",
  "marketing",
  "product",
  "social",
  "uncategorized",
  "utilities",
]);

function normalizeLane(value: unknown): TriageLane | null {
  if (value === "actionable") return "needs_attention";
  return typeof value === "string" && VALID_LANES.has(value) ? value as TriageLane : null;
}

function normalizeCategory(value: unknown): string | null {
  const normalized = String(value || "").toLowerCase().replace(/[^a-z0-9_]+/g, "_");
  return VALID_CATEGORIES.has(normalized) ? normalized : null;
}

function normalizeUrgency(value: unknown): TriageUrgency | null {
  return typeof value === "string" && VALID_URGENCIES.has(value) ? value as TriageUrgency : null;
}

function nonEmptyString(...values: unknown[]): string {
  for (const value of values) {
    const text = String(value || "").trim();
    if (text) return text;
  }
  return "";
}

function isManuallyVerified(row: TriageEvalRow): boolean {
  return row.labels_verified === true
    || row.manual_label === true
    || row.manually_verified === true;
}

function rowsFromFixture(fixture: unknown): TriageEvalRow[] {
  if (Array.isArray(fixture)) return fixture;
  if (!isRecord(fixture)) return [];
  if (Array.isArray(fixture.examples)) return fixture.examples as TriageEvalRow[];
  if (Array.isArray(fixture.eval_seed)) return fixture.eval_seed as TriageEvalRow[];
  return [];
}

function expectedFromRow(row: TriageEvalRow): TriageEvalExpected | null {
  const lane = normalizeLane(row.expected_lane);
  if (!lane) return null;

  const expected: TriageEvalExpected = {
    lane,
    category: normalizeCategory(row.expected_category),
    urgency: normalizeUrgency(row.expected_urgency),
    escalation_badge: row.expected_escalation_badge || null,
    deadline_at: row.expected_deadline_at || null,
  };
  if (row.expected_escalation || row.expected_should_escalate) {
    expected.escalation_expected = true;
  }
  if (typeof row.expected_preflight_action === "string" && VALID_PREFLIGHT_ACTIONS.has(row.expected_preflight_action)) {
    expected.preflight_action = row.expected_preflight_action as TriagePreflightAction;
  }
  if (row.expected_reason_code) {
    expected.reason_code = String(row.expected_reason_code);
  }
  return expected;
}

function emailFromRow(row: TriageEvalRow): TriageEmail {
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
  } as TriageEmail;
}

export function parseLabeledTriageExamples(fixture: unknown): TriageEvalExample[] {
  return rowsFromFixture(fixture)
    .filter((row) => isManuallyVerified(row))
    .map((row): TriageEvalExample | null => {
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
    .filter((example): example is TriageEvalExample => example !== null);
}

function hasEscalation(decision: Record<string, unknown> = {}): boolean {
  return Boolean(decision.escalation_badge || decision.escalation_expected);
}

function validateDecision(decision: Record<string, unknown> = {}, expected: Partial<TriageEvalExpected> = {}): string[] {
  const failures: string[] = [];
  if ((typeof decision.lane !== "string" || !VALID_LANES.has(decision.lane)) && expected.preflight_action !== "grace") failures.push("invalid_lane");
  if (!("category" in decision)) {
    failures.push("missing_category");
  } else if (decision.category != null && (typeof decision.category !== "string" || !VALID_CATEGORIES.has(decision.category))) {
    failures.push("invalid_category");
  }
  if (!("urgency" in decision)) {
    failures.push("missing_urgency");
  } else if (decision.urgency != null && (typeof decision.urgency !== "string" || !VALID_URGENCIES.has(decision.urgency))) {
    failures.push("invalid_urgency");
  }
  if (!("escalation_badge" in decision)) failures.push("missing_escalation_badge");
  if (!("deadline_at" in decision)) failures.push("missing_deadline_at");
  return failures;
}

function compareEvalResult(result: TriageEvalResult): { problems: string[]; schemaFailures: string[] } {
  const expected = result.expected || {};
  const actual = result.actual || {};
  const schemaFailures = validateDecision(actual, expected);
  const problems: string[] = [];

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
  if (
    expected.lane
    && actual.lane !== expected.lane
    && expected.preflight_action !== "grace"
    && !problems.includes("false_negative_needs_attention")
  ) {
    problems.push("lane_mismatch");
  }
  if (expected.category && actual.category !== expected.category) {
    problems.push("category_mismatch");
  }
  if (expected.preflight_action && actual.preflight_action !== expected.preflight_action) {
    problems.push("preflight_action_mismatch");
  }
  if (expected.reason_code && actual.reason_code !== expected.reason_code) {
    problems.push("reason_code_mismatch");
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
    exact_preflight_action_matches: 0,
  };
}

export function buildTriageEvalReport(results: TriageEvalResult[]) {
  const stats = emptyStats();
  const dangerous_misses: Record<string, unknown>[] = [];
  const mismatches: Record<string, unknown>[] = [];
  const schema_failures: Record<string, unknown>[] = [];

  for (const result of results) {
    stats.total += 1;
    const { problems, schemaFailures } = compareEvalResult(result);

    if (result.actual?.lane === result.expected?.lane) stats.exact_lane_matches += 1;
    if (result.expected?.category && result.actual?.category === result.expected.category) {
      stats.exact_category_matches += 1;
    }
    if (result.expected?.preflight_action && result.actual?.preflight_action === result.expected.preflight_action) {
      stats.exact_preflight_action_matches += 1;
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

function createNoRulesDbClient(): TriageDb {
  return {
    async execute() {
      return { rows: [] };
    },
  };
}

function mockDecisionForTier(example: TriageEvalExample, tier: TriageModelTier): Record<string, unknown> {
  const candidate = example.mock_model_outputs[tier]
    || example.mock_model_outputs?.default
    || null;
  if (isRecord(candidate)) return candidate;
  return {
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

function createMockModelClient(example: TriageEvalExample): TriageModelClient {
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
}: { fixturePath?: string; useRealModels?: boolean; dbClient?: TriageDb } = {}) {
  if (!fixturePath) throw new Error("fixturePath is required");
  if (useRealModels && process.env.EA_TRIAGE_EVAL_REAL_MODELS !== "1") {
    throw new Error("Set EA_TRIAGE_EVAL_REAL_MODELS=1 to run real triage model calls");
  }

  const fixture: unknown = JSON.parse(await readFile(fixturePath, "utf8"));
  const examples = parseLabeledTriageExamples(fixture);
  const results: TriageEvalResult[] = [];

  for (const example of examples) {
    const routed = await routeEmailForTriage(example.email, {
      dbClient,
      modelClient: useRealModels ? undefined : createMockModelClient(example),
    });
    const preflight = routed.preflight;
    const decisionMetadata = routed.decision && isRecord(routed.decision.decision_metadata)
      ? routed.decision.decision_metadata
      : {};
    const preflightMetadata = isRecord(decisionMetadata.preflight) ? decisionMetadata.preflight : {};
    const actual = routed.grace && preflight
      ? {
        lane: null,
        category: preflight.category,
        urgency: preflight.urgency,
        escalation_badge: preflight.escalation_badge || null,
        deadline_at: null,
        preflight_action: "grace",
        reason_code: preflight.reasonCode,
      }
      : {
        ...routed.decision,
        preflight_action: preflightMetadata.action,
        reason_code: preflightMetadata.reasonCode,
      };
    results.push({
      id: example.id,
      expected: example.expected,
      actual,
      modelCalls: routed.modelCalls,
    });
  }

  return {
    fixturePath,
    labeled_examples: examples.length,
    ...buildTriageEvalReport(results),
  };
}
