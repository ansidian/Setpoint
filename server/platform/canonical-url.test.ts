import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createClient, type Client } from "@libsql/client";
import {
  buildCanonicalOriginImpact,
  createCanonicalUrlService,
  deriveCanonicalUrls,
  normalizeCanonicalOrigin,
  resolveLegacyCanonicalOrigin,
} from "./canonical-url.ts";

describe("canonical URL model", () => {
  it("normalizes an HTTPS origin and rejects paths, unsafe schemes, and proxy-looking input", () => {
    expect(normalizeCanonicalOrigin("https://Setpoint.Example.com/", { production: true }))
      .toBe("https://setpoint.example.com");
    expect(() => normalizeCanonicalOrigin("https://setpoint.example.com/setup", { production: true }))
      .toThrow("Canonical URL must contain only an origin");
    expect(() => normalizeCanonicalOrigin("http://setpoint.example.com", { production: true }))
      .toThrow("Canonical URL must use HTTPS");
    expect(() => normalizeCanonicalOrigin("javascript:alert(1)", { production: false }))
      .toThrow("Canonical URL must use HTTP or HTTPS");
    expect(() => normalizeCanonicalOrigin("https://setpoint.example.com, https://proxy.example.com", { production: true }))
      .toThrow("Canonical URL is invalid");
  });

  it("retains safe localhost development origins", () => {
    expect(normalizeCanonicalOrigin("http://127.0.0.1:5173", { production: false }))
      .toBe("http://127.0.0.1:5173");
    expect(() => normalizeCanonicalOrigin("http://example.com", { production: false }))
      .toThrow("Non-local canonical URLs must use HTTPS");
  });

  it("deterministically derives WebAuthn and provider callback values", () => {
    expect(deriveCanonicalUrls("https://setpoint.example.com")).toEqual({
      canonicalOrigin: "https://setpoint.example.com",
      webAuthn: {
        rpName: "Setpoint",
        rpId: "setpoint.example.com",
        origin: "https://setpoint.example.com",
      },
      callbacks: {
        googleOAuth: "https://setpoint.example.com/api/ea/accounts/gmail/callback",
        todoistOAuth: "https://setpoint.example.com/api/ea/accounts/todoist/callback",
        gmailPubSub: "https://setpoint.example.com/api/gmail/push",
        todoistWebhook: "https://setpoint.example.com/api/todoist/webhook",
      },
    });
  });

  it("reports no passkey or callback changes for the current normalized origin", () => {
    const impact = buildCanonicalOriginImpact(
      "https://dashboard.example.com",
      "https://dashboard.example.com/",
      2,
    );

    expect(impact.affectedPasskeys).toBe(0);
    expect(impact.callbacks.every((callback) => callback.previousUrl === callback.nextUrl)).toBe(true);
  });

  it("imports only compatible legacy origin and redirect configuration", () => {
    expect(resolveLegacyCanonicalOrigin({
      NODE_ENV: "production",
      EA_WEBAUTHN_RP_ID: "setpoint.example.com",
      EA_WEBAUTHN_ORIGIN: "https://setpoint.example.com",
      GOOGLE_REDIRECT_URI: "https://setpoint.example.com/api/ea/accounts/gmail/callback",
    })).toBe("https://setpoint.example.com");
    expect(resolveLegacyCanonicalOrigin({
      NODE_ENV: "production",
      EA_WEBAUTHN_ORIGIN: "https://old.example.com",
      GOOGLE_REDIRECT_URI: "https://new.example.com/api/ea/accounts/gmail/callback",
    })).toBeNull();
    expect(resolveLegacyCanonicalOrigin({
      NODE_ENV: "production",
      GOOGLE_REDIRECT_URI: "https://setpoint.example.com/not-the-google-callback",
    })).toBeNull();
  });
});

describe("canonical URL persistence", () => {
  let db: Client;

  beforeEach(async () => {
    db = createClient({ url: "file::memory:" });
    await db.executeMultiple(`
      CREATE TABLE ea_instance_metadata (
        singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
        canonical_origin TEXT NOT NULL,
        source TEXT NOT NULL,
        confirmed_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);
  });

  afterEach(() => db.close());

  it("persists an explicit confirmation and never reads request headers", async () => {
    const service = createCanonicalUrlService(db);
    await service.setConfirmedOrigin("https://setpoint.example.com", 123);
    await expect(service.getCanonicalOrigin()).resolves.toBe("https://setpoint.example.com");
    await expect(service.resolveCanonicalOrigin({
      NODE_ENV: "production",
      HOST: "attacker.example.com",
      HTTP_X_FORWARDED_HOST: "proxy.example.com",
    })).resolves.toBe("https://setpoint.example.com");
  });

  it("imports one unambiguous legacy origin without replacing stored state", async () => {
    const service = createCanonicalUrlService(db);
    await expect(service.resolveCanonicalOrigin({
      NODE_ENV: "production",
      EA_WEBAUTHN_RP_ID: "legacy.example.com",
      EA_WEBAUTHN_ORIGIN: "https://legacy.example.com",
    }, 456)).resolves.toBe("https://legacy.example.com");
    await expect(service.resolveCanonicalOrigin({
      NODE_ENV: "production",
      EA_WEBAUTHN_ORIGIN: "https://different.example.com",
    })).resolves.toBe("https://legacy.example.com");
  });
});
