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
  const from = String(value || "").trim();
  // Match one whole mailbox. A quoted display name can itself contain an email
  // address; only the angle-bracket address supplies the authenticated identity.
  const bracketed = from.match(/^(?:(?:"(?:[^"\\\r\n]|\\[^\r\n])*"|[^"<>@,;:\\\r\n]+)\s*)?<[^<>\s@,;:"\\()]+@([a-z0-9.-]+)>$/i);
  const bare = from.match(/^[^<>\s@,;:"\\()]+@([a-z0-9.-]+)$/i);
  return normalizedDomain(bracketed?.[1] || bare?.[1]);
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
  const fromHeaders = headers.filter((header) => header.name.toLowerCase() === "from");
  const fromDomain = fromHeaders.length === 1 ? addressDomain(fromHeaders[0]?.value) : null;
  const authenticationHeaders = headers.filter((header) => header.name.toLowerCase() === "authentication-results");
  const first = authenticationHeaders[0]?.value?.trim() || "";
  const googleResults = authenticationHeaders.filter((header) => /\bmx\.google\.com\b/i.test((header.value || "").split(";")[0] || ""));
  if (!claimedDomain || fromDomain !== claimedDomain || !/^mx\.google\.com\s*;/i.test(first) || googleResults.length !== 1) {
    return unavailableEmailAuthentication("gmail", claimedFrom, now);
  }

  const results = parseGmailAuthenticationResults(first);
  if (!results || results.filter((entry) => entry.method === "dmarc").length > 1
    || results.filter((entry) => entry.method === "spf").length > 1) return unavailableEmailAuthentication("gmail", claimedFrom, now);
  const dkimResults = results.filter((entry) => entry.method === "dkim");
  if (dkimResults.length > 16 || dkimResults.some((entry, index) => dkimResults.slice(index + 1).some((other) => sameDkimResultIdentity(entry, other)))) {
    return unavailableEmailAuthentication("gmail", claimedFrom, now);
  }
  const dkim = dkimResults.map((entry) => {
    const domain = gmailDkimSigningDomain(entry.properties, headers);
    return { result: entry.result, domain, aligned: domain === claimedDomain };
  });
  const spfResult = results.find((entry) => entry.method === "spf");
  const spfDomain = spfResult ? normalizedDomain(spfResult.properties["smtp.mailfrom"] || spfResult.properties["smtp.helo"]) : null;
  const spf = spfResult ? { result: spfResult.result, domain: spfDomain, aligned: spfDomain === claimedDomain } : null;
  const dmarcResult = results.find((entry) => entry.method === "dmarc");
  const headerFromDomain = dmarcResult ? strictSigningDomain(dmarcResult.properties["header.from"]) : claimedDomain;
  const dmarc = dmarcResult ? { result: dmarcResult.result, domain: headerFromDomain, aligned: headerFromDomain === claimedDomain } : null;
  // Exact DKIM d= alignment authenticates the Author Domain (RFC 9989 §4.4.1).
  // This is sender authority, not an invented DMARC evaluation. An explicit
  // DMARC result of any kind always controls; SPF alone is never this fallback.
  const status: EmailAuthenticationStatus = dmarc
    ? ["pass", "fail", "none"].includes(dmarc.result)
      ? !dmarc.aligned || dmarc.result === "fail" ? "fail" : dmarc.result === "pass" ? "pass" : "none"
      : "unavailable"
    : dkim.some((entry) => entry.result === "pass" && entry.aligned) ? "pass" : "unavailable";
  return projection("gmail", "gmail_authentication_results", status, headerFromDomain, now.toISOString(), { dkim, spf, dmarc });
}

interface GmailAuthenticationResult {
  method: string;
  result: string;
  properties: Record<string, string>;
}

/** Parse the observed Auth-Results grammar without accepting properties from comments/reasons. */
function parseGmailAuthenticationResults(input: string): GmailAuthenticationResult[] | null {
  if (input.length > 65_536) return null;
  const segments: string[] = [];
  let text = "";
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (const character of input.replace(/\r?\n[ \t]+/g, " ")) {
    if (escaped) { if (!depth) text += character; escaped = false; continue; }
    if ((depth || quoted) && character === "\\") { if (quoted) text += character; escaped = true; continue; }
    if (character === '"' && !depth) { quoted = !quoted; text += character; continue; }
    if (!quoted && character === "(") { depth++; text += " "; continue; }
    if (!quoted && character === ")") { if (!depth) return null; depth--; continue; }
    if (depth) continue;
    if (/[\r\n]/.test(character)) return null;
    if (!quoted && character === ";") { segments.push(text.trim()); text = ""; }
    else text += character;
  }
  if (depth || quoted || escaped) return null;
  segments.push(text.trim());
  const entries: GmailAuthenticationResult[] = [];
  const methods = segments.slice(1).filter(Boolean);
  if (methods.length > 1 && methods.some((entry) => entry.toLowerCase() === "none")) return null;
  for (const segment of methods) {
    if (segment.toLowerCase() === "none") continue;
    const match = segment.match(/^([a-z][a-z0-9_-]*)\s*=\s*([a-z]+)(?=\s|$)/i);
    if (!match) return null;
    const properties: Record<string, string> = {};
    let remaining = segment.slice(match[0].length).trim();
    while (remaining) {
      const property = remaining.match(/^([a-z][a-z0-9_.-]*)\s*=\s*(?:"((?:[^"\\]|\\.)*)"|([^\s";]+))(?=\s|$)/i);
      if (!property) return null;
      const name = property[1]!.toLowerCase();
      if (Object.hasOwn(properties, name)) return null;
      properties[name] = property[2] !== undefined ? property[2].replace(/\\(.)/g, "$1") : property[3]!;
      remaining = remaining.slice(property[0].length).trim();
    }
    entries.push({ method: match[1]!.toLowerCase(), result: match[2]!.toLowerCase(), properties });
  }
  return entries;
}

function strictSigningDomain(value: string | undefined): string | null {
  return value && /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i.test(value)
    ? value.toLowerCase() : null;
}

function dkimIdentity(value: string | undefined): { value: string; domain: string } | null {
  const match = value?.match(/^([^@\s<>"\\]*)@([^@\s]+)$/);
  const domain = strictSigningDomain(match?.[2]);
  return match && domain ? { value: `${match[1]}@${domain}`, domain } : null;
}

function sameDkimResultIdentity(left: GmailAuthenticationResult, right: GmailAuthenticationResult): boolean {
  const leftPrefix = left.properties["header.b"];
  const rightPrefix = right.properties["header.b"];
  if (leftPrefix && rightPrefix) return leftPrefix.startsWith(rightPrefix) || rightPrefix.startsWith(leftPrefix);
  const leftDomain = strictSigningDomain(left.properties["header.d"]) || dkimIdentity(left.properties["header.i"])?.domain;
  const rightDomain = strictSigningDomain(right.properties["header.d"]) || dkimIdentity(right.properties["header.i"])?.domain;
  return Boolean(leftDomain && rightDomain
    && (leftDomain === rightDomain || leftDomain.endsWith(`.${rightDomain}`) || rightDomain.endsWith(`.${leftDomain}`))
    && (!left.properties["header.s"] || !right.properties["header.s"] || left.properties["header.s"] === right.properties["header.s"]));
}

function gmailDkimSigningDomain(properties: Record<string, string>, headers: AuthenticationHeader[]): string | null {
  const identity = dkimIdentity(properties["header.i"]);
  const reportedDomain = strictSigningDomain(properties["header.d"]);
  if (Object.hasOwn(properties, "header.d")) {
    // i= may name d= or one of its subdomains, but never establishes d= itself
    // (RFC 6376 §3.5). It cannot override a different reported signing domain.
    if (!reportedDomain || (properties["header.i"] && (!identity || (identity.domain !== reportedDomain && !identity.domain.endsWith(`.${reportedDomain}`))))) return null;
    return reportedDomain;
  }
  const prefix = properties["header.b"];
  if (!identity || !prefix || !/^[A-Za-z0-9+/]{8,}={0,2}$/.test(prefix)) return null;
  const signatures: Record<string, string>[] = [];
  const signatureHeaders = headers.filter((header) => header.name.toLowerCase() === "dkim-signature");
  if (signatureHeaders.length > 16) return null;
  for (const header of signatureHeaders) {
    const tags: Record<string, string> = {};
    for (const item of (header.value || "").replace(/\r?\n[ \t]+/g, " ").split(";").map((item) => item.trim()).filter(Boolean)) {
      const tag = item.match(/^([a-z][a-z0-9]*)\s*=\s*([\s\S]*)$/i);
      if (!tag || Object.hasOwn(tags, tag[1]!.toLowerCase())) return null;
      tags[tag[1]!.toLowerCase()] = tag[2]!.trim();
    }
    signatures.push(tags);
  }
  // RFC 6008 §4: header.b is a case-sensitive, >=8-character signature prefix.
  // Require one original signature; adding a colliding copy cannot select an
  // arbitrary unverified d=. The selector and AUID must also agree when given.
  const matched = signatures.filter((signature) => signature.b?.replace(/\s/g, "").startsWith(prefix));
  if (matched.length !== 1) return null;
  const signature = matched[0]!;
  const domain = strictSigningDomain(signature.d);
  const signatureIdentity = dkimIdentity(signature.i || (domain ? `@${domain}` : undefined));
  if (signature.v !== "1" || !/^[A-Za-z0-9+/]+={0,2}$/.test(signature.b?.replace(/\s/g, "") || "") || !domain || signatureIdentity?.value !== identity.value
    || (properties["header.s"] && signature.s !== properties["header.s"])
    || (identity.domain !== domain && !identity.domain.endsWith(`.${domain}`))
    || Object.hasOwn(signature, "l")) return null;
  return domain;
}

function evaluateAuthenticationResults(
  provider: EmailProvider,
  results: string,
  claimedDomain: string,
  now: Date,
): EmailAuthenticationProjection {
  const segments = results.split(";").slice(1).map((segment) => segment.trim()).filter(Boolean);
  const dkim = segments.flatMap((segment) => {
    const result = resultValue(segment, "dkim");
    if (!result) return [];
    const domain = propertyDomain(segment, ["header.d", "header.i"]);
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
    provider,
    provider === "icloud" ? "icloud_authentication_results" : "gmail_authentication_results",
    status,
    headerFromDomain,
    now.toISOString(),
    { dkim, spf, dmarc },
  );
}

// This is the observed iCloud SMTP ingress layout, not a generic search for an
// Apple-looking authserv-id. Unknown layouts must not authorize financial writes.
// As with Gmail, provider verdicts rely on the receiver sanitizing forged copies.
const ICLOUD_AUTH_SERVICES = ["bimi.icloud.com", "arc.icloud.com", "dmarc.icloud.com", "dkim-verifier.icloud.com", "spf.icloud.com"];
const ICLOUD_PROCESSING_HEADERS = new Set([
  "x-icl-repid", "x-icl-info", "x-icl-score", "authentication-results",
  "x-arc-info", "x-dmarc-policy", "x-dmarc-info", "received-spf",
]);

function withoutAuthenticationComments(value: string): string | null {
  let depth = 0;
  let escaped = false;
  let clean = "";
  for (const character of value) {
    if (escaped) { escaped = false; continue; }
    if (depth && character === "\\") { escaped = true; continue; }
    if (character === "(") { depth++; clean += " "; continue; }
    if (character === ")") { if (!depth) return null; depth--; continue; }
    if (!depth) {
      // Quoted property values are outside the supported Apple layout.
      if (character === '"' || character === "\\" || /[\r\n]/.test(character)) return null;
      clean += character;
    }
  }
  return depth || escaped ? null : clean;
}

export function evaluateICloudSenderAuthentication(
  headers: AuthenticationHeader[],
  claimedFrom: string,
  now: Date = new Date(),
): EmailAuthenticationProjection {
  const unavailable = () => unavailableEmailAuthentication("icloud", claimedFrom, now);
  const claimedDomain = addressDomain(claimedFrom);
  if (!claimedDomain) return unavailable();
  const normalized = headers.map(({ name, value }) => ({
    name: name.toLowerCase(), value: (value || "").replace(/\r?\n[ \t]+/g, " ").trim(),
  }));
  const received = normalized.flatMap((header, index) => header.name === "received" ? [index] : []);
  const [deliveryIndex, ingressIndex] = received;
  if (deliveryIndex === undefined || ingressIndex === undefined) return unavailable();
  const delivery = normalized[deliveryIndex]!.value;
  const ingress = normalized[ingressIndex]!.value;
  const incomingHost = delivery.match(/^from (p\d+-icloudmta-smtpin-[a-z0-9-]+)\s+by p\d+-mailgateway-smtp-[a-z0-9-]+\s+\(mailgateway\b/i)?.[1];
  const ingressHost = ingress.match(/\sby (p\d+-icloudmta-smtpin-[a-z0-9-]+)\s+\(Postfix\)/i)?.[1];
  if (!incomingHost || incomingHost.toLowerCase() !== ingressHost?.toLowerCase()) return unavailable();
  if (normalized.slice(0, ingressIndex).some((header) => header.name === "authentication-results")) return unavailable();

  const block: AuthenticationHeader[] = [];
  const seen = new Set<string>();
  for (const header of normalized.slice(ingressIndex + 1)) {
    if (!ICLOUD_PROCESSING_HEADERS.has(header.name)) break;
    if (header.name !== "authentication-results" && seen.has(header.name)) return unavailable();
    seen.add(header.name);
    block.push(header);
  }
  if (!["x-icl-repid", "x-icl-info", "x-icl-score"].every((name) => seen.has(name))) return unavailable();
  const results = block.filter((header) => header.name === "authentication-results").map((header) => header.value || "");
  if (results.length !== ICLOUD_AUTH_SERVICES.length || results.some((value, index) => (value.split(";")[0] || "").trim().toLowerCase() !== ICLOUD_AUTH_SERVICES[index])) return unavailable();
  // A second Apple verdict anywhere in the message headers is ambiguous, even
  // when the first block looks valid. Do not recover a missing result downstream.
  // Count apparent copies too, including commented/versioned authserv syntax
  // outside the strict format accepted above.
  const appleResults = normalized.filter((header) => header.name === "authentication-results"
    && ICLOUD_AUTH_SERVICES.some((service) => header.value.toLowerCase().includes(service)));
  if (appleResults.length !== results.length) return unavailable();
  const mechanisms = ["bimi", "arc", "dmarc", "dkim", "spf"];
  const cleanResults = results.map(withoutAuthenticationComments);
  for (const [index, value] of cleanResults.entries()) {
    if (!value) return unavailable();
    const segments = value.split(";").slice(1).map((segment) => segment.trim()).filter(Boolean);
    if (segments.length !== 1 || !segments[0]?.toLowerCase().startsWith(`${mechanisms[index]}=`)) return unavailable();
  }
  // Exactly one syntactically valid Header-From property; comment text and
  // repeated properties cannot supply or override the DMARC identity.
  if (!/^dmarc=(?:pass|fail|none|temperror|permerror)\s+header\.from=[a-z0-9.-]+\s*$/i.test((cleanResults[2]?.split(";")[1] || "").trim())) return unavailable();
  const fromHeaders = normalized.filter((header) => header.name === "from");
  const from = fromHeaders[0]?.value || "";
  if (fromHeaders.length !== 1 || addressDomain(from) !== claimedDomain) return unavailable();
  return evaluateAuthenticationResults("icloud", `icloud;${cleanResults.slice(2).map((value) => value!.slice(value!.indexOf(";") + 1)).join(";")}`, claimedDomain, now);
}
