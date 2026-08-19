import type { InStatement } from "@libsql/client";
import type { FetchFunction } from "../platform/fetch-with-timeout.ts";
import type {
  EffectiveEmailTriageMode,
  StoredEmailTriageMode,
} from "../../shared/types/settings.ts";

export type TriageLane = "needs_attention" | "fyi" | "noise";
export type TriageUrgency = "high" | "medium" | "normal" | "low";
export type TriageModelTier = "cheap" | "strong";
export type TriagePreflightAction = "finalize" | "audit" | "route_model";
export type TriageJobStatus = "queued" | "running" | "complete" | "failed";

export interface TriageDbResult {
  rows: Record<string, unknown>[];
  rowsAffected?: number;
}

export interface TriageDb {
  execute(statement: string | InStatement): Promise<TriageDbResult>;
}

export interface TriageJob extends Record<string, unknown> {
  id: string | number | bigint;
  user_id: string;
  account_id: string;
  email_id: string;
  attempts?: string | number | bigint | null;
  status?: TriageJobStatus;
  scheduled_for?: string | null;
}

export interface TriageEmail extends Record<string, unknown> {
  triage_id?: string | number | bigint;
  triage_status?: string | null;
  triage_source?: string | null;
  last_triaged_at?: string | null;
  provider_state?: string | null;
  dismissed_at?: string | null;
  user_id: string;
  account_id: string;
  email_id: string;
  uid?: string;
  thread_id?: string | null;
  account_label?: string | null;
  account_email?: string | null;
  account_color?: string | null;
  account_icon?: string | null;
  from_name?: string | null;
  from_address?: string | null;
  subject?: string | null;
  body_snippet?: string | null;
  body_text?: string | null;
  email_date?: string | null;
  email_date_utc?: string | null;
  read?: boolean | number | string | bigint | null;
  snoozed_until_ts?: string | number | bigint | null;
}

export interface TriageDecision extends Record<string, unknown> {
  lane: TriageLane;
  category: string;
  urgency: TriageUrgency;
  escalation_badge: string | null;
  summary: string;
  action: string;
  deadline_at: string | null;
  confidence: number | null;
  triage_source: string;
  rule_id: string | number | bigint | null;
  model_usage: Record<string, unknown>;
  estimated_cost_usd: number | null;
  latency_ms: number | null;
  cheap_model_result: Record<string, unknown> | null;
  strong_model_result: Record<string, unknown> | null;
  bill_candidate: Record<string, unknown> | null;
  decision_metadata: Record<string, unknown> | null;
  last_decision_reason: string | null;
  error: string | null;
  snapshot_source?: string | null;
  snapshot_source_at?: string | null;
}

export type TriageDecisionOverrides = Partial<TriageDecision>;

export interface TriageRuleMatch extends Record<string, unknown> {
  enabled?: boolean;
  action?: string;
  mode?: string;
  sensitivity?: string;
  reason_code?: string;
  decision_action?: string;
  metadata?: Record<string, unknown>;
  from_addresses?: unknown[];
  from_domains?: unknown[];
  from_domain_suffixes?: unknown[];
  from_name_includes?: unknown[];
  subject_includes?: unknown[];
  subject_regex?: string;
  snippet_includes?: unknown[];
  body_includes?: unknown[];
  body_regex?: string;
  all_includes?: unknown[];
  any_includes?: unknown[];
  none_includes?: unknown[];
  hard_risk_exclusions?: unknown[];
  risk_exclusions?: unknown[];
  allow_body_match?: boolean;
  body_match_enabled?: boolean;
  allow_legacy_any_finalize?: boolean;
  allow_hard_risk_finalize?: boolean;
}

export interface TriageRule extends Record<string, unknown> {
  id?: string | number | bigint | null;
  key?: string;
  name?: string;
  priority?: string | number | bigint | null;
  match_json: TriageRuleMatch | string;
  lane?: string | null;
  category?: string | null;
  urgency?: string | null;
  escalation_badge?: string | null;
  reason?: string | null;
  reason_code?: string | null;
  rule_type?: string | null;
  route_to_model?: string | null;
  confidence?: string | number | null;
  sensitivity?: string | null;
  profile_group?: string | null;
  profileGroup?: string | null;
}

export interface TriageInterestPromotion {
  originalLane: TriageLane;
  originalReasonCode: string;
  originalMatchedRuleKey: string | null;
  originalCategory: string;
}

export interface TriagePreflightResult extends Record<string, unknown> {
  action: TriagePreflightAction;
  lane: TriageLane | null;
  category: string;
  urgency: TriageUrgency;
  escalation_badge: string | null;
  summary: string;
  decisionAction: string;
  deadline_at: string | null;
  modelTier: TriageModelTier | null;
  reasonCode: string;
  sensitivity: string;
  confidence: number | null;
  riskOverride: boolean;
  matchedRuleKey: string | null;
  ruleId: string | number | bigint | null;
  modelSaved: boolean;
  audit: boolean;
  riskReason: string | null;
  matchedInterest: string | null;
  interestPromotion: TriageInterestPromotion | null;
  matchedTextScope?: string;
  metadata?: Record<string, unknown> | null;
}

export interface TriageModelUsage extends Record<string, unknown> {
  input_tokens?: number;
  output_tokens?: number;
  prompt_tokens_details?: { cached_tokens?: number };
  input_tokens_details?: { cached_tokens?: number };
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}

export interface TriageModelResult extends Record<string, unknown> {
  decision: Record<string, unknown>;
  usage: TriageModelUsage;
  provider: string;
  model?: string;
  tier: TriageModelTier;
  latency_ms: number;
}

export interface TriageModelClient {
  classify(input: {
    tier: TriageModelTier;
    email: Record<string, unknown>;
    reason: string;
  }): Promise<Record<string, unknown>>;
}

export interface TriageModelChoice {
  provider: string;
  model: string;
}

export interface TriageModelConfig {
  cheap: TriageModelChoice;
  strong: TriageModelChoice;
}

export interface TriageFetchResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  text?(): Promise<string>;
}

export type TriageFetch = FetchFunction<TriageFetchResponse>;

export interface TriageModeResult {
  email_triage_mode: StoredEmailTriageMode;
  effective_email_triage_mode: EffectiveEmailTriageMode;
}

export interface TriageBatchContext {
  getMode(userId: string): Promise<TriageModeResult>;
  getClassifyReadArrivals(userId: string): Promise<boolean>;
  getRules(userId: string): Promise<TriageRule[]>;
  getInterests(userId: string): Promise<string[]>;
  getModelClient(userId: string): Promise<TriageModelClient>;
}

export type TriageError = Error & {
  status?: number;
  retryable?: boolean;
};

export function triageError(error: unknown): TriageError {
  return error instanceof Error ? error as TriageError : new Error(String(error));
}
