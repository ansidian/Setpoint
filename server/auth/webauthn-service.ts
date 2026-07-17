import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from "@simplewebauthn/server";
import type {
  AuthenticationResponseJSON,
  RegistrationResponseJSON,
  VerifyAuthenticationResponseOpts,
  VerifyRegistrationResponseOpts,
  WebAuthnCredential,
} from "@simplewebauthn/server";
import { resolveWebAuthnConfig } from "./webauthn-config.ts";
import type { WebAuthnConfig } from "./webauthn-config.ts";
import type { StoredPasskeyCredential } from "./passkey-store.ts";

type ServiceConfig = Pick<WebAuthnConfig, "rpName" | "rpId" | "origin">;

function publicKeyFromBase64Url(value: string) {
  return Buffer.from(value || "", "base64url");
}

function challengeFromBase64Url(value: string) {
  return Buffer.from(value || "", "base64url");
}

function toWebAuthnCredential(passkey: StoredPasskeyCredential): WebAuthnCredential {
  return {
    id: passkey.credentialId,
    publicKey: publicKeyFromBase64Url(passkey.publicKey),
    counter: passkey.signCount,
    transports: passkey.transports,
  };
}

export async function buildAuthenticationOptions({
  passkeys,
  challenge,
  config = resolveWebAuthnConfig(),
}: {
  passkeys: StoredPasskeyCredential[];
  challenge: string;
  config?: ServiceConfig;
}) {
  return generateAuthenticationOptions({
    rpID: config.rpId,
    challenge: challengeFromBase64Url(challenge),
    userVerification: "required",
    allowCredentials: passkeys.map((passkey) => ({
      id: passkey.credentialId,
      transports: passkey.transports,
    })),
  });
}

export async function buildRegistrationOptions({
  userId,
  existingPasskeys,
  challenge,
  config = resolveWebAuthnConfig(),
}: {
  userId: string;
  existingPasskeys: StoredPasskeyCredential[];
  challenge: string;
  config?: ServiceConfig;
}) {
  return generateRegistrationOptions({
    rpName: config.rpName,
    rpID: config.rpId,
    userName: userId,
    userID: Buffer.from(userId),
    userDisplayName: "Setpoint",
    challenge: challengeFromBase64Url(challenge),
    attestationType: "none",
    authenticatorSelection: {
      residentKey: "preferred",
      userVerification: "required",
    },
    excludeCredentials: existingPasskeys.map((passkey) => ({
      id: passkey.credentialId,
      transports: passkey.transports,
    })),
  });
}

export async function verifyRegistrationCredential({
  response,
  expectedChallenge,
  config = resolveWebAuthnConfig(),
}: {
  response: RegistrationResponseJSON;
  expectedChallenge: VerifyRegistrationResponseOpts["expectedChallenge"];
  config?: ServiceConfig;
}) {
  return verifyRegistrationResponse({
    response,
    expectedChallenge,
    expectedOrigin: config.origin,
    expectedRPID: config.rpId,
    expectedType: "webauthn.create",
    requireUserVerification: true,
  });
}

export async function verifyAuthenticationCredential({
  response,
  passkey,
  expectedChallenge,
  config = resolveWebAuthnConfig(),
}: {
  response: AuthenticationResponseJSON;
  passkey: StoredPasskeyCredential;
  expectedChallenge: VerifyAuthenticationResponseOpts["expectedChallenge"];
  config?: ServiceConfig;
}) {
  return verifyAuthenticationResponse({
    response,
    expectedChallenge,
    expectedOrigin: config.origin,
    expectedRPID: config.rpId,
    expectedType: "webauthn.get",
    requireUserVerification: true,
    credential: toWebAuthnCredential(passkey),
  });
}
