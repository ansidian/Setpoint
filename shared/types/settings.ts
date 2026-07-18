export type StoredEmailTriageMode = "auto" | "real" | "no_model" | "paused";
export type EffectiveEmailTriageMode = Exclude<StoredEmailTriageMode, "auto">;

export interface BriefingSchedule {
  label: string;
  time: string;
  enabled: boolean;
  tz?: string;
  skipped_until?: string;
}

export interface TriageSoundTriggerSetting {
  enabled: boolean;
  soundId: string;
}

export type TriageSoundLaneScope = "needs_attention_only" | "needs_attention_and_fyi";
export type TriageSoundTriggerKey =
  | "needs_attention_finalized"
  | "email_queued"
  | "fyi_finalized"
  | "weak_security_grace"
  | "triage_failed"
  | "event_upcoming"
  | "task_completed";

export interface TriageSoundSettings {
  laneScope: TriageSoundLaneScope;
  volume: number;
  triggers: Record<TriageSoundTriggerKey, TriageSoundTriggerSetting>;
}

export interface TriageNotificationSound {
  id: string;
  label: string;
  path: string;
}

export interface TriageCacheTierStats {
  calls: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  estimatedSavingsUsd: number;
}

export interface TriageCacheStatsWindow {
  windowDays: number | null;
  windowLabel: string | null;
  generatedAt?: string;
  openaiCalls: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  estimatedSavingsUsd: number;
  hitRate: number;
  lastTriagedAt?: string | null;
  models?: string[];
  byTier?: {
    cheap: TriageCacheTierStats;
    strong: TriageCacheTierStats;
  };
}

export interface TriageCacheStatsResponse extends TriageCacheStatsWindow {
  generatedAt: string;
  lastTriagedAt: string | null;
  models: string[];
  byTier: {
    cheap: TriageCacheTierStats;
    strong: TriageCacheTierStats;
  };
  comparisonWindows: {
    monthToDate: TriageCacheStatsWindow;
  };
}

export type BillPayMatcher = string | string[];
export type BillPayMatcherGroup = BillPayMatcher[];

export interface BillPayBehaviorTargets {
  payee_id?: string;
  payee_label?: string;
  account_id?: string;
  account_label?: string;
  category_id?: string;
  category_label?: string;
  from_account_id?: string;
  from_account_label?: string;
  to_account_id?: string;
  to_account_label?: string;
  schedule_name?: string;
}

export interface BillPayBehavior {
  id?: string;
  name?: string;
  enabled?: boolean;
  type?: "transfer" | "bill" | "expense" | "income";
  intent?: {
    subject?: BillPayMatcherGroup;
    body?: BillPayMatcherGroup;
  };
  amountStrategy?: "statement_balance" | "minimum_due" | "amount_due" | "model_amount" | "none";
  amountFallback?: "blank_if_not_found" | "use_model_amount";
  targets?: BillPayBehaviorTargets;
}

export interface BillPayProfile {
  id?: string;
  name?: string;
  enabled?: boolean;
  identity?: {
    sender?: BillPayMatcherGroup;
    domain?: BillPayMatcherGroup;
    aliases?: BillPayMatcherGroup;
    last4?: BillPayMatcherGroup;
  };
  behaviors?: BillPayBehavior[];
}

export interface BillPayMappings {
  version: 1;
  profiles: BillPayProfile[];
}

export interface UtilityPayLink {
  scheduleId: string;
  label: string;
  url: string;
}

export interface ImportantSender {
  address: string;
  name?: string;
  source?: "manual" | "auto";
}

export interface ProviderModelOption {
  id: string;
  label: string;
}

export interface ProviderModelAvailability {
  provider: string;
  label: string;
  envVar?: string;
  available: boolean;
  defaultModel: string;
  models: ProviderModelOption[];
}

export interface GeocodeResult {
  name: string;
  lat: number;
  lng: number;
}

export interface SettingsResponse {
  user_id: string;
  email_lookback_hours: number | null;
  weather_lat: number | null;
  weather_lng: number | null;
  weather_location: string | null;
  actual_budget_url: string | null;
  actual_budget_sync_id: string | null;
  email_ai_provider: string;
  email_ai_model: string;
  bill_extract_provider: string;
  bill_extract_model: string;
  email_triage_mode: StoredEmailTriageMode;
  email_triage_effective_mode: EffectiveEmailTriageMode;
  discord_user_id: string | null;
  todoist_needs_reauth: boolean;
  actual_budget_configured: boolean;
  todoist_configured: boolean;
  todoist_oauth_configured: boolean;
  todoist_connection_mode: "disconnected" | "personal_token" | "oauth";
  discord_webhook_configured: boolean;
  schedules: BriefingSchedule[];
  email_interests: string[];
  triage_sound_settings: TriageSoundSettings;
  triage_notification_sounds: TriageNotificationSound[];
  bill_pay_mappings: BillPayMappings;
  utility_pay_links: UtilityPayLink[];
}

export interface TodoistOAuthTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
}

export interface SettingsPatchRequest {
  schedules_json?: BriefingSchedule[] | string;
  email_lookback_hours?: number;
  weather_lat?: number;
  weather_lng?: number;
  weather_location?: string;
  actual_budget_url?: string;
  actual_budget_password?: string;
  actual_budget_sync_id?: string;
  email_ai_provider?: string;
  email_ai_model?: string;
  email_interests_json?: string[] | string;
  todoist_api_token?: string;
  todoist_oauth_token_response?: TodoistOAuthTokenResponse | string;
  bill_extract_provider?: string;
  bill_extract_model?: string;
  email_triage_mode?: StoredEmailTriageMode;
  triage_sound_settings?: TriageSoundSettings;
  bill_pay_mappings?: BillPayMappings;
  discord_webhook_url?: string;
  discord_user_id?: string;
  utility_pay_links?: UtilityPayLink[];
}

export interface SettingsMutationResponse {
  success: true;
}

export interface ScheduleSkipRequest {
  index?: number;
  skip?: boolean;
}

export interface ScheduleSkipResponse extends SettingsMutationResponse {
  schedules: BriefingSchedule[];
}
