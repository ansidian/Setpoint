import type { InstanceCredentialMetadata } from "../../../../shared/types/instance-credentials";
import type { StatusTone } from "../settings-ui";

type CredentialStatusView = {
  activeLabel: string;
  activeTone: StatusTone;
  pendingLabel: string | null;
  pendingTone: StatusTone;
};

const ERROR_MESSAGES: Record<string, string> = {
  INVALID_CREDENTIAL: "The provider rejected this credential. Check the value and try again.",
  RATE_LIMITED: "The provider rate-limited the test. The active credential is unchanged; try again shortly.",
  PROVIDER_UNAVAILABLE: "The provider could not be reached. The active credential is unchanged; try again later.",
  VALIDATION_FAILED: "The provider could not validate this credential.",
  HOST_CREDENTIAL_UNAVAILABLE: "No host-managed value is available for this credential.",
  AI_CREDENTIAL_PENDING_REQUIRED: "Enter a replacement before testing.",
  LOCATION_CREDENTIAL_PENDING_REQUIRED: "Enter a replacement before testing.",
};

export function credentialErrorMessage(code: unknown): string {
  return typeof code === "string" && ERROR_MESSAGES[code]
    ? ERROR_MESSAGES[code]
    : "The credential could not be validated.";
}

export function credentialStatusView(metadata: InstanceCredentialMetadata): CredentialStatusView {
  const active = metadata.source === "stored"
    ? { label: "Setpoint", tone: "success" as const }
    : metadata.source === "environment"
      ? { label: "Host environment", tone: "accent" as const }
      : metadata.source === "disabled"
        ? { label: "Disabled", tone: "warning" as const }
        : { label: "Not configured", tone: "neutral" as const };

  let pendingLabel: string | null = null;
  let pendingTone: StatusTone = "neutral";
  if (metadata.pendingConfigured) {
    if (metadata.validationState === "invalid") {
      pendingLabel = "Pending replacement failed";
      pendingTone = "danger";
    } else {
      pendingLabel = "Pending replacement";
      pendingTone = "warning";
    }
  }
  return {
    activeLabel: active.label,
    activeTone: active.tone,
    pendingLabel,
    pendingTone,
  };
}

export function formatCredentialTimestamp(timestamp: number | null): string | null {
  if (timestamp === null) return null;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(timestamp));
}

export function pendingCredentialExpiryLabel(metadata: InstanceCredentialMetadata): string | null {
  if (!metadata.pendingConfigured || metadata.pendingExpiresAt === null) return null;
  return `Pending candidate expires ${formatCredentialTimestamp(metadata.pendingExpiresAt)}`;
}
