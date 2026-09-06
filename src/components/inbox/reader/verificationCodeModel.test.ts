import { expect, it } from "vitest";
import { resolveVerificationCodeAction } from "./verificationCodeModel";

it("keeps a deferred code copyable without promising a trash mutation", () => {
  const email = {
    uid: "code", _snoozed: true,
    verification_code: { code: "123456", kind: "numeric" as const, active_until: "2030-01-01T01:00:00Z", label: "Verification code" as const },
  };
  const options = { nowMs: Date.parse("2030-01-01T00:00:00Z") };
  expect(resolveVerificationCodeAction(email, options)).toMatchObject({ visible: true, canActivate: true, copyOnly: true });
  expect(resolveVerificationCodeAction({ ...email, _snoozed: false }, options)).toMatchObject({ visible: true, copyOnly: false });
  expect(resolveVerificationCodeAction({ ...email, _snoozedUnavailable: true }, options)).toMatchObject({ visible: false, canActivate: false });
});
