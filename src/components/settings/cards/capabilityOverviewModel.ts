import type { CapabilityId, CapabilityStatus } from "../../../../shared/types/capabilities";
import type { StatusTone } from "../settings-ui";

const OPTIONAL_CAPABILITIES = new Set<CapabilityId>([
  "gmail_realtime",
  "todoist_advanced",
  "calendar_places",
]);

export interface CapabilityStatusView {
  label: string;
  tone: StatusTone;
  optional: boolean;
}

export function projectCapabilityStatus(capability: CapabilityStatus): CapabilityStatusView {
  const optional = OPTIONAL_CAPABILITIES.has(capability.id);
  if (capability.id === "gmail_realtime" && capability.mode === "periodic" && capability.state === "not_configured") {
    return { label: "Periodic updates", tone: "success", optional };
  }
  if (capability.id === "todoist_advanced" && capability.mode === "periodic" && capability.state === "not_configured") {
    return { label: "Personal token + periodic sync", tone: "success", optional };
  }
  if (capability.reasonCodes.includes("ACCOUNT_REAUTH_REQUIRED") || capability.reasonCodes.includes("TODOIST_REAUTH_REQUIRED")) {
    return { label: "Reconnect needed", tone: "danger", optional };
  }
  switch (capability.state) {
    case "ready": return { label: "Working", tone: "success", optional };
    case "degraded": return { label: "Partially working", tone: "warning", optional };
    case "pending": return { label: "Pending validation", tone: "accent", optional };
    case "needs_attention": return { label: "Needs attention", tone: "danger", optional };
    case "disabled": return { label: "Disabled", tone: "neutral", optional };
    default: return { label: "Not configured", tone: "neutral", optional };
  }
}
