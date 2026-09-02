import type {
  EmailAuthenticationProjection,
} from "../../shared/types/email.ts";
import type {
  FinancialEmailSourceIdentity,
} from "../../shared/types/bills.ts";

function parseProjection(value: unknown): EmailAuthenticationProjection | null {
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    if (!parsed || typeof parsed !== "object") return null;
    const candidate = parsed as Partial<EmailAuthenticationProjection>;
    if (candidate.version !== 1
      || !["pass", "fail", "none", "unavailable"].includes(String(candidate.status))
      || !["gmail", "icloud"].includes(String(candidate.provider))) return null;
    return candidate as EmailAuthenticationProjection;
  } catch {
    return null;
  }
}

export function triageFinancialSourceIdentity(email: {
  account_id: string;
  from_address?: string | null;
  sender_authentication_json?: unknown;
}): FinancialEmailSourceIdentity {
  const projection = parseProjection(email.sender_authentication_json);
  return {
    provider: projection?.provider || null,
    accountId: email.account_id,
    senderAddress: email.from_address || null,
    senderAuthentication: projection?.status || "unavailable",
    authenticationEvidence: projection ? [
      `sender-auth:v${projection.version}`,
      `source:${projection.source}`,
      `header-from:${projection.headerFromDomain || "unavailable"}`,
      `dmarc:${projection.dmarc?.result || "unavailable"}`,
      `spf:${projection.spf?.result || "unavailable"}`,
      ...projection.dkim.map((entry) => `dkim:${entry.result}:${entry.aligned ? "aligned" : "unaligned"}`),
    ] : [],
  };
}
