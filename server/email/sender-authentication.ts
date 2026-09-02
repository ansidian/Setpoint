import type {
  EmailAuthenticationProjection,
  EmailAuthenticationStatus,
  EmailProvider,
} from "../../shared/types/email.ts";

export interface AuthenticationHeader {
  name: string;
  value?: string;
}

const DOMAIN = /(?:^|@)([a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,})$/i;
const RESULT = /^(pass|fail|softfail|neutral|none|temperror|permerror|policy)\b/i;

function normalizedDomain(value: unknown): string | null {
  const clean = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/^@/, "")
    .replace(/[)>;,]+$/, "");
  return clean.match(DOMAIN)?.[1] || null;
}

function addressDomain(value: unknown): string | null {
  const match = String(value || "").match(/<?[^<>\s@]+@([^<>\s]+)>?/);
  return normalizedDomain(match?.[1]);
}

function propertyDomain(segment: string, names: string[]): string | null {
  for (const name of names) {
    const match = segment.match(new RegExp(`(?:^|\\s)${name.replace(".", "\\.")}=([^\\s;]+)`, "i"));
    const domain = normalizedDomain(match?.[1]);
    if (domain) return domain;
  }
  return null;
}

function resultValue(segment: string, mechanism: string): string | null {
  const match = segment.trim().match(new RegExp(`^${mechanism}=([^\\s;]+)`, "i"));
  return match?.[1]?.match(RESULT)?.[1]?.toLowerCase() || null;
}

function projection(
  provider: EmailProvider,
  source: EmailAuthenticationProjection["source"],
  status: EmailAuthenticationStatus,
  headerFromDomain: string | null,
  evaluatedAt: string,
  details: Pick<EmailAuthenticationProjection, "dkim" | "spf" | "dmarc"> = { dkim: [], spf: null, dmarc: null },
): EmailAuthenticationProjection {
  return { version: 1, status, provider, source, headerFromDomain, ...details, evaluatedAt };
}

export function unavailableEmailAuthentication(
  provider: EmailProvider,
  claimedFrom: string,
  now: Date = new Date(),
): EmailAuthenticationProjection {
  return projection(
    provider,
    provider === "icloud" ? "icloud_unavailable" : "gmail_authentication_results",
    "unavailable",
    addressDomain(claimedFrom),
    now.toISOString(),
  );
}

export function evaluateGmailSenderAuthentication(
  headers: AuthenticationHeader[],
  claimedFrom: string,
  now: Date = new Date(),
): EmailAuthenticationProjection {
  const claimedDomain = addressDomain(claimedFrom);
  const authenticationHeaders = headers.filter((header) => header.name.toLowerCase() === "authentication-results");
  const first = authenticationHeaders[0]?.value?.trim() || "";
  if (!claimedDomain || !/^mx\.google\.com\s*;/i.test(first)) {
    return unavailableEmailAuthentication("gmail", claimedFrom, now);
  }

  const segments = first.split(";").slice(1).map((segment) => segment.trim()).filter(Boolean);
  const dkim = segments.flatMap((segment) => {
    const result = resultValue(segment, "dkim");
    if (!result) return [];
    const domain = propertyDomain(segment, ["header.i", "header.d"]);
    return [{ result, domain, aligned: domain === claimedDomain }];
  });
  const spfSegment = segments.find((segment) => resultValue(segment, "spf"));
  const spfResult = spfSegment ? resultValue(spfSegment, "spf") : null;
  const spfDomain = spfSegment ? propertyDomain(spfSegment, ["smtp.mailfrom", "smtp.helo"]) : null;
  const spf = spfResult
    ? { result: spfResult, domain: spfDomain, aligned: spfDomain === claimedDomain }
    : null;
  const dmarcSegment = segments.find((segment) => resultValue(segment, "dmarc"));
  const dmarcResult = dmarcSegment ? resultValue(dmarcSegment, "dmarc") : null;
  const headerFromDomain = dmarcSegment
    ? propertyDomain(dmarcSegment, ["header.from"])
    : claimedDomain;
  const dmarc = dmarcResult
    ? { result: dmarcResult, domain: headerFromDomain, aligned: headerFromDomain === claimedDomain }
    : null;
  const status: EmailAuthenticationStatus = !dmarc
    ? "unavailable"
    : !dmarc.aligned || dmarc.result === "fail"
      ? "fail"
      : dmarc.result === "pass"
        ? "pass"
        : dmarc.result === "none"
          ? "none"
          : "unavailable";
  return projection(
    "gmail",
    "gmail_authentication_results",
    status,
    headerFromDomain,
    now.toISOString(),
    { dkim, spf, dmarc },
  );
}
