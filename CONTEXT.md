# EA Dashboard

EA Dashboard is a single-owner personal assistant surface that aggregates sensitive personal data. Authentication language should distinguish full dashboard access from partial setup or verification states.

## Language

**Dashboard Password**:
The existing shared secret that proves knowledge of the dashboard login credential.
_Avoid_: Master password, account password

**Passkey**:
A WebAuthn credential controlled by a trusted device, platform authenticator, or hardware security key.
_Avoid_: MFA code, recovery key

**Registered Passkey**:
The server-side record of a passkey credential that EA Dashboard can verify.
_Avoid_: Stored passkey, private key

**Pending Password Authentication**:
A short-lived state proving the dashboard password was accepted but full dashboard access has not yet been granted.
_Avoid_: Session, logged in

**WebAuthn Challenge**:
A short-lived one-time verification prompt created for passkey registration or authentication.
_Avoid_: Login session, recovery token

**Authenticated Session**:
The final dashboard session granted only after all required authentication steps are complete.
_Avoid_: Pending auth, partial login

**Scoped API Token**:
A bearer credential for explicitly opted-in automation routes, not a dashboard login credential.
_Avoid_: Session token, dashboard token

**Session Boundary Rotation**:
The rule that existing dashboard sessions are revoked or rotated when passkey requirements materially change.
_Avoid_: Passive session carryover

**Passkey Management**:
The authenticated Settings workflow for registering and deleting passkeys.
_Avoid_: Login recovery, passkey-only login

**Passkey Reset**:
A local operator recovery action that clears registered passkeys and returns future login to password-only setup mode.
_Avoid_: Recovery code, reset endpoint

**Passkey Prompt**:
The browser or authenticator ceremony used to prove control of a registered passkey during login.
_Avoid_: Manual second login page, passkey-only login

**Passkey Storage Separation**:
The owner preference that the passkey should live outside EA Dashboard and outside the password manager that stores the dashboard password.
_Avoid_: Bitwarden enforcement, dashboard-stored passkey

## Relationships

- EA Dashboard has one owner; passkey authentication uses that owner identity and does not introduce usernames or multi-account login.
- A **Dashboard Password** can create **Pending Password Authentication** when a **Registered Passkey** exists.
- A **Passkey** verifies against exactly one **Registered Passkey** record.
- An **Authenticated Session** is created only after **Pending Password Authentication** is followed by successful **Passkey** verification.
- A **Scoped API Token** can remain valid for its narrow automation scope after passkey enforcement, but it does not create or replace an **Authenticated Session**.
- **Session Boundary Rotation** happens when the first **Registered Passkey** is added or a **Registered Passkey** is deleted, so old sessions do not outlive a material authentication boundary change.
- **Passkey Storage Separation** is an owner operating rule and product-copy requirement, not a reliable browser-enforceable guarantee.
- **Pending Password Authentication** is held in an `httpOnly`, 5-minute cookie; browser JavaScript should only receive flow state, not a reusable pending-auth token.
- A **WebAuthn Challenge** expires after 5 minutes and is consumed on success or failure; failed passkey verification does not end still-valid **Pending Password Authentication**.
- Removing the final **Registered Passkey** intentionally returns future login to password-only setup mode, but only from an existing **Authenticated Session** and with **Session Boundary Rotation**.
- **Passkey Management** requires an **Authenticated Session**; it does not add a separate fresh reauthentication step in the initial passkey rollout.
- **Pending Password Authentication** can complete login with an existing **Registered Passkey**, but it cannot register a new **Passkey**.
- **Passkey Reset** is performed through local server or database access, not through a public HTTP recovery endpoint or recovery-code credential.
- **Passkey Reset** clears registered passkeys, pending authentication, WebAuthn challenges, and authenticated sessions so the next login starts cleanly in password-only setup mode.
- **Pending Password Authentication** is cleared by login cancellation or logout cleanup, but passkey rollout does not require a new front-facing dashboard logout control.
- After password success, the **Passkey Prompt** starts immediately when a **Registered Passkey** exists; manual controls are fallback/retry affordances, not the primary flow.
- Password attempts and passkey attempts are throttled separately; a failed or canceled **Passkey Prompt** does not count as a failed **Dashboard Password** attempt.
- **Authenticated Sessions** remain the only remembered access state; there is no separate trusted-browser or remember-device bypass for future logins.
- **Passkey Management** supports deleting individual **Registered Passkeys** in Settings, while reset-all recovery stays local through **Passkey Reset**.
- Deleting an individual **Registered Passkey** revokes existing authenticated sessions and may issue a fresh current-browser session for the authenticated browser performing the deletion.

## Example Dialogue

> **Dev:** "After the **Dashboard Password** succeeds, should we create an **Authenticated Session**?"
> **Domain expert:** "Only when no **Registered Passkey** exists. Otherwise create **Pending Password Authentication** and require the **Passkey** before full access."

## Flagged Ambiguities

- "Outside Bitwarden" was resolved as **Passkey Storage Separation**: EA Dashboard should recommend and support device or hardware-key passkeys, but should not claim it can reliably detect or block Bitwarden-hosted passkeys through browser WebAuthn.
- "Pending auth token" was resolved as cookie-held **Pending Password Authentication**, not a JSON token the frontend stores or passes manually.
- "Delete passkey" includes deleting the final **Registered Passkey**; this is a deliberate recovery path, not an invalid state.
