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
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!password || submitting) return;
    if (password !== confirmation) {
      setError("Passwords do not match");
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const result = await claimOwner(password);
      setPassword("");
      setConfirmation("");
      setRecoveryCodes(result.recoveryCodes);
    } catch (error) {
      setPassword("");
      setConfirmation("");
      setError(errorMessage(error));
      passwordRef.current?.focus();
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
                      : "Create the owner password for this Setpoint instance. The first successful claim closes public setup permanently."}
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
                  Your password is hashed on the server and never returned to this browser.
                </p>
              </div>

              <div className="space-y-3">
                <div>
                  <label htmlFor="owner-password" className="mb-1.5 block text-[12px] font-medium text-foreground">
                    Create password
                  </label>
                  <Input
                    id="owner-password"
                    ref={passwordRef}
                    type="password"
                    autoComplete="new-password"
                    value={password}
                    disabled={submitting}
                    autoFocus
                    onChange={(event) => {
                      setPassword(event.target.value);
                      if (error) setError(null);
                    }}
                  />
                </div>
                <div>
                  <label htmlFor="owner-password-confirmation" className="mb-1.5 block text-[12px] font-medium text-foreground">
                    Confirm password
                  </label>
                  <Input
                    id="owner-password-confirmation"
                    type="password"
                    autoComplete="new-password"
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
                disabled={!password || !confirmation || submitting}
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
