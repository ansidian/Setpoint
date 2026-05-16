import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from "@simplewebauthn/server";
import { resolveWebAuthnConfig } from "./webauthn-config.js";

function publicKeyFromBase64Url(value) {
  return Buffer.from(value || "", "base64url");
}

function challengeFromBase64Url(value) {
  return Buffer.from(value || "", "base64url");
}

function toWebAuthnCredential(passkey) {
  return {
    id: passkey.credentialId,
    publicKey: publicKeyFromBase64Url(passkey.publicKey),
    counter: passkey.signCount,
    transports: passkey.transports,
  };
}

export async function buildAuthenticationOptions({ passkeys, challenge, config = resolveWebAuthnConfig() }) {
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
