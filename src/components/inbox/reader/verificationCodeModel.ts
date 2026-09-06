import { buildTrashCommand } from "../inboxCommandModel";
import type { InboxEmailLike } from "../inboxTypes";

export function verificationCodeActiveUntilMs(email: InboxEmailLike | null | undefined): number | null {
  const activeUntilMs = Date.parse(email?.verification_code?.active_until || "");
  return Number.isFinite(activeUntilMs) ? activeUntilMs : null;
}

export function isVerificationCodeFresh(
  email: InboxEmailLike | null | undefined,
  nowMs: number = Date.now(),
): boolean {
  const code = email?.verification_code?.code;
  const activeUntilMs = verificationCodeActiveUntilMs(email);
  return typeof code === "string"
    && code.length > 0
    && activeUntilMs != null
    && nowMs < activeUntilMs;
}

export function resolveVerificationCodeAction(
  email: InboxEmailLike | null | undefined,
  {
    nowMs = Date.now(),
    readOnly = false,
    copying = false,
  }: {
    nowMs?: number;
    readOnly?: boolean;
    copying?: boolean;
  } = {},
) {
  const trash = buildTrashCommand(email, { readOnly });
  const copyOnly = !!email?._snoozed && !email._snoozedUnavailable;
  const visible = isVerificationCodeFresh(email, nowMs)
    && !email?._providerRemoved
    && (copyOnly || (trash.allowed && trash.uid != null));

  return {
    visible,
    copyOnly,
    canActivate: visible && !copying,
    code: visible ? email?.verification_code?.code || null : null,
    activeUntilMs: visible ? verificationCodeActiveUntilMs(email) : null,
  };
}
