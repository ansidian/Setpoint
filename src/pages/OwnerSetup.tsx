import { useRef, useState } from "react";
import type { FormEvent, ReactElement } from "react";
import { KeyRound, ShieldCheck } from "lucide-react";
import { claimOwner } from "../setupApi";
import { publicAssetUrl } from "@/publicAsset";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export interface OwnerSetupProps {
  onClaimed: () => void;
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : "Setup could not be completed";
}

export default function OwnerSetup({ onClaimed }: OwnerSetupProps): ReactElement {
  const [setupToken, setSetupToken] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [canonicalOrigin, setCanonicalOrigin] = useState(() => window.location.origin);
  const [originConfirmed, setOriginConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const setupTokenRef = useRef<HTMLInputElement>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!setupToken || !password || !canonicalOrigin || !originConfirmed || submitting) return;
    if (password.length < 12) {
      setError("Password must be at least 12 characters");
      return;
    }
    if (password !== confirmation) {
      setError("Passwords do not match");
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const result = await claimOwner(setupToken, password, canonicalOrigin);
      setSetupToken("");
      setPassword("");
      setConfirmation("");
      setRecoveryCodes(result.recoveryCodes);
    } catch (error) {
      setSetupToken("");
      setPassword("");
      setConfirmation("");
      setError(errorMessage(error));
      setupTokenRef.current?.focus();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="relative isolate min-h-screen overflow-hidden px-4 py-8 text-foreground">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10"
        style={{ background: "radial-gradient(ellipse at top, var(--sp-page), var(--sp-deep) 60%)" }}
      />

      <div className="flex min-h-[calc(100vh-4rem)] items-center justify-center">
        <form className="w-full max-w-[420px]" onSubmit={handleSubmit}>
          <Card className="bg-card/90">
            <CardHeader className="gap-3 border-b border-white/[0.04] pb-5">
              <img
                src={publicAssetUrl("setpoint.svg")}
                alt="Setpoint"
                className="h-8 w-auto self-start"
              />
              <div className="flex items-start gap-3">
                <span className="mt-0.5 inline-flex size-9 shrink-0 items-center justify-center rounded-lg border border-[var(--sp-accent)]/20 bg-[var(--sp-accent)]/10 text-[var(--sp-accent)]">
                  <ShieldCheck aria-hidden="true" size={18} />
                </span>
                <div className="min-w-0">
                  <CardTitle className="text-balance text-[18px] leading-snug">
                    {recoveryCodes ? "Save your recovery codes" : "Claim your private workspace"}
                  </CardTitle>
                  <CardDescription className="mt-1 max-w-[52ch] text-pretty text-[12px] leading-relaxed">
                    {recoveryCodes
                      ? "Store these offline. Each code works once, and Setpoint will not show this set again."
                      : "Prove access to this deployment, then create its single owner. A successful claim closes setup permanently."}
                  </CardDescription>
                </div>
              </div>
            </CardHeader>

            <CardContent className="space-y-4 pt-5">
              {recoveryCodes ? (
                <>
                  <div className="rounded-lg border border-[var(--sp-cream)]/20 bg-[var(--sp-cream)]/5 p-3">
                    <ul aria-label="Recovery codes" className="grid gap-2 sm:grid-cols-2">
                      {recoveryCodes.map((code) => (
                        <li key={code}>
                          <code className="block select-all break-all rounded-md bg-black/20 px-2 py-1.5 text-[11px] text-foreground">
                            {code}
                          </code>
                        </li>
                      ))}
                    </ul>
                  </div>
                  <p className="text-pretty text-[12px] leading-relaxed text-muted-foreground">
                    Keep these somewhere separate from this device. Regenerating recovery codes later invalidates this set.
                  </p>
                  <Button
                    type="button"
                    size="lg"
                    className="w-full motion-reduce:transition-none motion-reduce:hover:translate-y-0 motion-reduce:active:translate-y-0"
                    onClick={onClaimed}
                  >
                    I saved these codes
                  </Button>
                </>
              ) : (
                <>
              <div className="rounded-lg border border-white/[0.06] bg-white/[0.025] px-3 py-3 text-[12px] leading-relaxed text-muted-foreground">
                <span className="inline-flex items-center gap-2 font-medium text-foreground">
                  <KeyRound aria-hidden="true" size={14} className="text-[var(--sp-accent)]" />
                  Single-owner access
                </span>
                <p className="mt-1.5 text-pretty">
                  Use the setup token generated by your host. It is checked once and never stored by Setpoint.
                </p>
              </div>

              <div className="space-y-3">
                <div>
                  <label htmlFor="deployment-setup-token" className="mb-1.5 block text-[12px] font-medium text-foreground">
                    Deployment setup token
                  </label>
                  <Input
                    id="deployment-setup-token"
                    ref={setupTokenRef}
                    type="password"
                    autoComplete="off"
                    spellCheck={false}
                    value={setupToken}
                    disabled={submitting}
                    autoFocus
                    onChange={(event) => {
                      setSetupToken(event.target.value);
                      if (error) setError(null);
                    }}
                  />
                  <p className="mt-1.5 text-pretty text-[11px] leading-relaxed text-muted-foreground">
                    Copy `EA_SETUP_TOKEN` from your deployment's secret environment settings.
                  </p>
                </div>
                <div>
                  <label htmlFor="canonical-setpoint-url" className="mb-1.5 block text-[12px] font-medium text-foreground">
                    Canonical Setpoint URL
                  </label>
                  <Input
                    id="canonical-setpoint-url"
                    type="url"
                    autoComplete="url"
                    value={canonicalOrigin}
                    disabled={submitting}
                    onChange={(event) => {
                      setCanonicalOrigin(event.target.value);
                      setOriginConfirmed(false);
                      if (error) setError(null);
                    }}
                  />
                  <p className="mt-1.5 text-pretty text-[11px] leading-relaxed text-muted-foreground">
                    Passkeys and provider callbacks will use this origin. Change it later only after updating external provider consoles.
                  </p>
                </div>
                <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-white/[0.08] bg-white/[0.025] px-3 py-2.5 text-[12px] leading-relaxed text-foreground transition-colors hover:border-white/[0.14] hover:bg-white/[0.04] focus-within:border-primary/30 focus-within:ring-2 focus-within:ring-primary/20 motion-reduce:transition-none">
                  <input
                    type="checkbox"
                    className="mt-0.5 size-4 shrink-0 accent-[var(--sp-accent)]"
                    checked={originConfirmed}
                    disabled={submitting}
                    onChange={(event) => setOriginConfirmed(event.target.checked)}
                  />
                  <span>Confirm this is the canonical URL visible in your browser.</span>
                </label>
                <div>
                  <label htmlFor="owner-password" className="mb-1.5 block text-[12px] font-medium text-foreground">
                    Create password
                  </label>
                  <Input
                    id="owner-password"
                    type="password"
                    autoComplete="new-password"
                    minLength={12}
                    value={password}
                    disabled={submitting}
                    onChange={(event) => {
                      setPassword(event.target.value);
                      if (error) setError(null);
                    }}
                  />
                  <p className="mt-1.5 text-pretty text-[11px] leading-relaxed text-muted-foreground">
                    Use at least 12 characters. A password manager-generated passphrase is recommended.
                  </p>
                </div>
                <div>
                  <label htmlFor="owner-password-confirmation" className="mb-1.5 block text-[12px] font-medium text-foreground">
                    Confirm password
                  </label>
                  <Input
                    id="owner-password-confirmation"
                    type="password"
                    autoComplete="new-password"
                    minLength={12}
                    value={confirmation}
                    disabled={submitting}
                    onChange={(event) => {
                      setConfirmation(event.target.value);
                      if (error) setError(null);
                    }}
                  />
                </div>
              </div>

              {error ? (
                <div
                  role="alert"
                  className="rounded-lg border border-[var(--sp-rose)]/20 bg-[var(--sp-rose)]/10 px-3 py-2 text-[12px] leading-relaxed text-[var(--sp-rose)]"
                >
                  {error}
                </div>
              ) : null}

              <Button
                type="submit"
                size="lg"
                className="w-full motion-reduce:transition-none motion-reduce:hover:translate-y-0 motion-reduce:active:translate-y-0"
                disabled={!setupToken || !password || !confirmation || !canonicalOrigin || !originConfirmed || submitting}
              >
                {submitting ? "Claiming Setpoint…" : "Claim Setpoint"}
              </Button>
                </>
              )}
            </CardContent>
          </Card>
        </form>
      </div>
    </main>
  );
}
