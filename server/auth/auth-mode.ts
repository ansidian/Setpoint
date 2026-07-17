export const OWNER_AUTH_MODES = ["password_or_passkey", "password_plus_passkey"] as const;
export type OwnerAuthMode = typeof OWNER_AUTH_MODES[number];

export function isOwnerAuthMode(value: unknown): value is OwnerAuthMode {
  return typeof value === "string" && OWNER_AUTH_MODES.includes(value as OwnerAuthMode);
}

export function resolvePasswordLogin(mode: OwnerAuthMode, passkeyCount: number) {
  if (mode === "password_or_passkey") {
    return { authenticated: true as const, passkeyRequired: false as const };
  }
  if (passkeyCount > 0) {
    return { authenticated: false as const, passkeyRequired: true as const };
  }
  return {
    authenticated: false as const,
    passkeyRequired: false as const,
    configurationError: true as const,
  };
}
