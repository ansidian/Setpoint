import { startAuthentication, startRegistration } from "@simplewebauthn/browser";

export function startPasskeyAuthentication(options) {
  return startAuthentication({ optionsJSON: options });
}

export function startPasskeyRegistration(options) {
  return startRegistration({ optionsJSON: options });
}
