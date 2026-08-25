import { webcrypto } from "crypto";
import type { InstanceCredentialMetadata } from "../../shared/types/instance-credentials.ts";
import type { InstanceCredentialService } from "../platform/instance-credential-service.ts";
import { canonicalUrlService } from "../platform/canonical-url.ts";

const TLDRAW_CREDENTIAL_KEY = "notes.tldraw_license_key";
const TLDRAW_PUBLIC_KEY = "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEHJh0uUfxHtCGyerXmmatE368Hd9rI6LH9oPDQihnaCryRFWEVeOvf9U/SPbyxX74LFyJs5tYeAHq5Nc0Ax25LQ";
const ANNUAL_LICENSE = 1;
const PERPETUAL_LICENSE = 1 << 1;
const EVALUATION_LICENSE = 1 << 4;
const GRACE_PERIOD_DAYS = 30;

type LicenseInfo = {
  hosts: string[];
  flags: number;
  expiryDate: string;
};

export type TldrawLicenseTestCode =
  | "VALID"
  | "INVALID_CREDENTIAL"
  | "WRONG_DOMAIN"
  | "EXPIRED"
  | "CANONICAL_DOMAIN_REQUIRED";

export class MissingPendingTldrawCredentialError extends Error {
  readonly code = "TLDRAW_CREDENTIAL_PENDING_REQUIRED";
  readonly status = 409;

  constructor() {
    super("A pending tldraw license is required");
  }
}

function decodeBase64(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(value, "base64"));
}

function matchesHost(hosts: string[], currentHostname: string): boolean {
  const current = currentHostname.toLowerCase();
  return hosts.some((hostValue) => {
    const host = hostValue.trim().toLowerCase();
    if (host === "*") return true;
    if (host === current || `www.${host}` === current || host === `www.${current}`) return true;
    if (!host.startsWith("*.")) return false;
    const suffix = host.slice(1);
    return current.endsWith(suffix) && current.length > suffix.length;
  });
}

function expiryCutoff(expiryDate: string, graceDays: number): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(expiryDate)) return Number.NaN;
  const parsed = new Date(`${expiryDate}T00:00:00.000Z`);
  return parsed.getTime() + (graceDays + 1) * 24 * 60 * 60 * 1000;
}

async function parseVerifiedLicense(value: string): Promise<LicenseInfo | null> {
  const cleaned = value.replace(/[\u200B-\u200D\uFEFF\r\n]/g, "");
  const dot = cleaned.lastIndexOf(".");
  if (dot <= 0) return null;
  const data = cleaned.slice(0, dot);
  const signature = cleaned.slice(dot + 1);
  const slash = data.indexOf("/");
  if (slash <= 0 || !data.slice(0, slash).startsWith("tldraw-")) return null;
  const encoded = data.slice(slash + 1);

  try {
    const key = await webcrypto.subtle.importKey(
      "spki",
      decodeBase64(TLDRAW_PUBLIC_KEY),
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"],
    );
    const verified = await webcrypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      key,
      decodeBase64(signature),
      decodeBase64(encoded),
    );
    if (!verified) return null;
    const decoded: unknown = JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
    if (!Array.isArray(decoded)
      || !Array.isArray(decoded[1])
      || !decoded[1].every((host) => typeof host === "string")
      || !Number.isSafeInteger(decoded[2])
      || typeof decoded[3] !== "string") return null;
    return { hosts: decoded[1], flags: decoded[2], expiryDate: decoded[3] };
  } catch {
    return null;
  }
}

export async function validateTldrawLicense(
  value: string,
  canonicalOrigin: string,
  now = Date.now(),
): Promise<TldrawLicenseTestCode> {
  const license = await parseVerifiedLicense(value);
  if (!license) return "INVALID_CREDENTIAL";
  if (!matchesHost(license.hosts, new URL(canonicalOrigin).hostname)) return "WRONG_DOMAIN";
  const isEvaluation = (license.flags & EVALUATION_LICENSE) === EVALUATION_LICENSE;
  const isExpiring = (license.flags & (ANNUAL_LICENSE | PERPETUAL_LICENSE)) !== 0 || isEvaluation;
  const cutoff = expiryCutoff(license.expiryDate, isEvaluation ? 0 : GRACE_PERIOD_DAYS);
  if (isExpiring && (!Number.isFinite(cutoff) || now >= cutoff)) return "EXPIRED";
  return "VALID";
}

async function runtimeCredentialService(): Promise<InstanceCredentialService> {
  return (await import("../platform/instance-credential-service.ts")).instanceCredentialService;
}

export async function resolveTldrawLicenseKey(
  credentials?: Pick<InstanceCredentialService, "resolve">,
): Promise<string | null> {
  const service = credentials ?? await runtimeCredentialService();
  return (await service.resolve(TLDRAW_CREDENTIAL_KEY)).value;
}

export function createTldrawCredentialManager({
  credentials,
  canonicalOrigin = () => canonicalUrlService.resolveCanonicalOrigin(process.env),
  now = Date.now,
  validate = validateTldrawLicense,
}: {
  credentials?: InstanceCredentialService;
  canonicalOrigin?: () => Promise<string | null>;
  now?: () => number;
  validate?: typeof validateTldrawLicense;
} = {}) {
  async function testPending(): Promise<{
    ok: boolean;
    code: TldrawLicenseTestCode;
    metadata: InstanceCredentialMetadata;
  }> {
    const service = credentials ?? await runtimeCredentialService();
    const pending = await service.readPending(TLDRAW_CREDENTIAL_KEY);
    if (!pending) throw new MissingPendingTldrawCredentialError();
    const origin = await canonicalOrigin();
    const code = origin
      ? await validate(pending.value, origin, now())
      : "CANONICAL_DOMAIN_REQUIRED";
    const metadata = code === "VALID"
      ? await service.promotePending(TLDRAW_CREDENTIAL_KEY, pending.version)
      : await service.recordPendingFailure(TLDRAW_CREDENTIAL_KEY, pending.version, code);
    return { ok: code === "VALID", code, metadata };
  }

  return { testPending };
}

export type TldrawCredentialManager = ReturnType<typeof createTldrawCredentialManager>;
export const tldrawCredentialManager = createTldrawCredentialManager();
