export type CapabilityId =
  | "email_calendar"
  | "ai"
  | "tasks"
  | "weather"
  | "finances"
  | "notifications"
  | "gmail_realtime"
  | "todoist_advanced"
  | "calendar_places";

export type CapabilityState =
  | "not_configured"
  | "pending"
  | "ready"
  | "degraded"
  | "needs_attention"
  | "disabled";

export type CapabilitySource =
  | "stored"
  | "environment"
  | "account"
  | "settings"
  | "mixed"
  | "disabled"
  | "absent";

export type CapabilityReasonCode =
  | "ACCOUNT_REAUTH_REQUIRED"
  | "APPLICATION_CREDENTIALS_MISSING"
  | "AI_PROVIDER_PARTIAL"
  | "CALENDAR_NOT_CONNECTED"
  | "CREDENTIAL_INVALID"
  | "GMAIL_WATCH_TEST_FAILED"
  | "OPERATION_FAILED"
  | "TODOIST_REAUTH_REQUIRED";

export type CapabilityActionId =
  | "configure"
  | "connect"
  | "disable"
  | "manage"
  | "migrate_environment"
  | "reconnect"
  | "test";

export interface CapabilityStatus {
  id: CapabilityId;
  state: CapabilityState;
  source: CapabilitySource;
  mode: string | null;
  reasonCodes: CapabilityReasonCode[];
  availableActions: CapabilityActionId[];
  guidanceRef: `setup.${CapabilityId}`;
  lastTestedAt: string | null;
  lastSucceededAt: string | null;
  lastFailedAt: string | null;
}

export interface CapabilityStatusResponse {
  generatedAt: string;
  capabilities: CapabilityStatus[];
}
