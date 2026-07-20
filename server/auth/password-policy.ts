export const MIN_NEW_PASSWORD_LENGTH = 12;
export const MAX_PASSWORD_LENGTH = 1024;

export function isVerifiablePassword(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_PASSWORD_LENGTH;
}

export function isAcceptableNewPassword(value: unknown): value is string {
  return typeof value === "string"
    && value.length >= MIN_NEW_PASSWORD_LENGTH
    && value.length <= MAX_PASSWORD_LENGTH;
}
