import { useState, useRef, useEffect } from "react";
import type { FormEvent, ReactElement } from "react";
import { KeyRound, Lock } from "lucide-react";
import {
  login,
  getPasskeyAuthenticationOptions,
  verifyPasskeyAuthentication,
  cancelPasskeyAuthentication,
} from "../api";
import { recoverOwnerAccess } from "../auth/securityApi";
import { startPasskeyAuthentication } from "../auth/passkeyBrowser";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { publicAssetUrl } from "@/publicAsset";

export type LoginProps = { onLogin: () => void };

type LoginPhase = "password" | "passkey" | "recovery" | "recovery-codes";
type PasskeyState = "idle" | "prompting" | "failed";
const AUTH_BUTTON_MOTION_CLASS = "motion-reduce:transition-none motion-reduce:hover:translate-y-0 motion-reduce:active:translate-y-0";

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "";
}

export default function Login({ onLogin }: LoginProps): ReactElement {
  const [password, setPassword] = useState("");
  const [recoveryCode, setRecoveryCode] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [locked, setLocked] = useState(false);
  const [phase, setPhase] = useState<LoginPhase>("password");
  const [passkeyState, setPasskeyState] = useState<PasskeyState>("idle");
  const inputRef = useRef<HTMLInputElement>(null);
  const passkeyAttemptRef = useRef(0);

  useEffect(() => {
    if (!locked && phase === "password") inputRef.current?.focus();
  }, [locked, phase]);

  async function beginPasskeyPrompt(): Promise<void> {
    const attemptId = passkeyAttemptRef.current + 1;
    passkeyAttemptRef.current = attemptId;
    setPasskeyState("prompting");
    setError(null);

    try {
      const options = await getPasskeyAuthenticationOptions();
      const credential = await startPasskeyAuthentication(options);
      const result = await verifyPasskeyAuthentication(credential);
      if (attemptId !== passkeyAttemptRef.current) return;
      if (result?.authenticated) {
        onLogin();
        return;
      }
      throw new Error("Passkey verification failed");
    } catch (err) {
      if (attemptId !== passkeyAttemptRef.current) return;
      setPasskeyState("failed");
      setError(getErrorMessage(err) || "Passkey check did not finish");
    }
  }

  async function handleBackToPassword(): Promise<void> {
    passkeyAttemptRef.current += 1;
    setLoading(false);
    setPasskeyState("idle");
    setPhase("password");
    setPassword("");
    setRecoveryCode("");
    setConfirmation("");
    setError(null);
    await cancelPasskeyAuthentication().catch(() => null);
    inputRef.current?.focus();
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    if (loading || locked) return;
    if (phase === "recovery") {
      if (!recoveryCode || !password) return;
      if (password !== confirmation) {
        setError("Passwords do not match");
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const result = await recoverOwnerAccess(recoveryCode, password);
        setRecoveryCode("");
        setPassword("");
        setConfirmation("");
        setRecoveryCodes(result.recoveryCodes);
        setPhase("recovery-codes");
      } catch (err) {
        setError(getErrorMessage(err) || "Recovery failed");
      } finally {
        setLoading(false);
      }
      return;
    }
    if (phase !== "password" || !password) return;
    setLoading(true);

    try {
      const result = await login(password);
      if (result?.passkeyRequired) {
        setPhase("passkey");
        setPassword("");
        setLoading(false);
        beginPasskeyPrompt();
        return;
      }
      if (result?.authenticated) {
        onLogin();
        return;
      }
      throw new Error("Invalid password");
    } catch (err) {
      const msg = getErrorMessage(err);
      if (msg.toLowerCase().includes("too many")) {
        setError(msg);
        setLocked(true);
        setTimeout(() => {
          setLocked(false);
          setError(null);
        }, 60_000);
      } else {
        setError(msg || "Invalid password");
      }
      inputRef.current?.focus();
    } finally {
      if (phase === "password") setLoading(false);
    }
  }

  const passkeyPrompting = phase === "passkey" && passkeyState === "prompting";

  return (
    <div className="relative isolate min-h-screen overflow-hidden px-4 py-8 text-foreground">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10"
        style={{ background: "radial-gradient(ellipse at top, var(--sp-page), var(--sp-deep) 60%)" }}
      />

      <div className="flex min-h-[calc(100vh-4rem)] items-center justify-center">
        <form className="w-full max-w-[380px]" onSubmit={handleSubmit}>
          <Card className="bg-card/85 backdrop-blur-[2px]">
            <CardHeader className="items-center gap-3 border-b border-white/[0.04] pb-5 text-center">
              <img
                src={publicAssetUrl("setpoint.svg")}
                alt="Setpoint"
                style={{ height: 32, filter: "drop-shadow(0 2px 8px color-mix(in srgb, var(--sp-accent) 18%, transparent))" }}
              />
              <div className="text-[11px] font-semibold tracking-[2.5px] uppercase text-muted-foreground">
                Private Access
              </div>
              <CardDescription className="text-[13px] text-muted-foreground/75">
                {phase === "recovery"
                  ? "Use one offline code and choose a new password"
                  : phase === "recovery-codes"
                    ? "Save the replacement codes before continuing"
                    : phase === "passkey"
                      ? "Finish the browser passkey prompt"
                      : "Choose your sign-in method"}
              </CardDescription>
            </CardHeader>

            <CardContent className="pt-5">
              <div className="space-y-4">
                {phase === "password" ? (
                  <div>
                    <label
                      htmlFor="dashboard-password"
                      className="mb-1.5 block text-[11px] font-medium tracking-[1.5px] uppercase text-muted-foreground"
                    >
                      Password
                    </label>
                    <Input
                      id="dashboard-password"
                      ref={inputRef}
                      type="password"
                      placeholder="Password"
                      value={password}
                      onChange={(e) => {
                        setPassword(e.target.value);
                        if (error && !locked) setError(null);
                      }}
                      disabled={locked}
                      autoFocus
                    />
                  </div>
                ) : phase === "passkey" ? (
                  <div className="rounded-lg border border-white/[0.06] bg-white/[0.025] px-3 py-3 text-left">
                    <div className="flex items-start gap-2.5">
                      <span className="mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-lg border border-[var(--sp-accent)]/20 bg-[var(--sp-accent)]/10 text-[var(--sp-accent)]">
                        <KeyRound size={15} />
                      </span>
                      <div className="min-w-0">
                        <div className="text-[12px] font-medium text-foreground">
                          Passkey required
                        </div>
                        <div className="mt-1 text-[12px] leading-relaxed text-muted-foreground/75">
                          Complete the browser prompt to finish signing in.
                        </div>
                      </div>
                    </div>
                  </div>
                ) : phase === "recovery" ? (
                  <div className="space-y-3 text-left">
                    <div>
                      <label htmlFor="recovery-code" className="mb-1.5 block text-[11px] font-medium tracking-[1.5px] uppercase text-muted-foreground">
                        Recovery code
                      </label>
                      <Input
                        id="recovery-code"
                        autoComplete="one-time-code"
                        value={recoveryCode}
                        onChange={(event) => setRecoveryCode(event.target.value)}
                        disabled={loading}
                        autoFocus
                      />
                    </div>
                    <div>
                      <label htmlFor="recovery-password" className="mb-1.5 block text-[11px] font-medium tracking-[1.5px] uppercase text-muted-foreground">
                        New password
                      </label>
                      <Input
                        id="recovery-password"
                        type="password"
                        autoComplete="new-password"
                        value={password}
                        onChange={(event) => setPassword(event.target.value)}
                        disabled={loading}
                      />
                    </div>
                    <div>
                      <label htmlFor="recovery-password-confirmation" className="mb-1.5 block text-[11px] font-medium tracking-[1.5px] uppercase text-muted-foreground">
                        Confirm new password
                      </label>
                      <Input
                        id="recovery-password-confirmation"
                        type="password"
                        autoComplete="new-password"
                        value={confirmation}
                        onChange={(event) => setConfirmation(event.target.value)}
                        disabled={loading}
                      />
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3 text-left">
                    <ul aria-label="Replacement recovery codes" className="grid gap-2">
                      {recoveryCodes.map((code) => (
                        <li key={code}>
                          <code className="block select-all break-all rounded-md bg-black/20 px-2 py-1.5 text-[11px] text-foreground">
                            {code}
                          </code>
                        </li>
                      ))}
                    </ul>
                    <p className="text-[12px] leading-relaxed text-muted-foreground/75">
                      These replace the code you used. Store them offline; this set will not be shown again.
                    </p>
                  </div>
                )}

                {error ? (
                  <div
                    className={`rounded-lg border px-3 py-2 text-left text-[12px] leading-relaxed ${
                      locked
                        ? "border-[var(--sp-cream)]/20 bg-[var(--sp-cream)]/10 text-[var(--sp-cream)]"
                        : "border-[var(--sp-rose)]/20 bg-[var(--sp-rose)]/10 text-[var(--sp-rose)]"
                    }`}
                    role="alert"
                  >
                    <span className="inline-flex items-center gap-1.5 font-medium">
                      {locked ? <Lock size={12} /> : null}
                      {error}
                    </span>
                  </div>
                ) : null}

                {phase === "password" ? (
                  <div className="space-y-2">
                    <Button
                      type="submit"
                      className={`w-full ${AUTH_BUTTON_MOTION_CLASS}`}
                      size="lg"
                      disabled={loading || !password || locked}
                    >
                      {loading ? "Signing in..." : locked ? "Locked" : "Sign in"}
                    </Button>
                    <Button
                      type="button"
                      className={`w-full ${AUTH_BUTTON_MOTION_CLASS}`}
                      variant="secondary"
                      size="lg"
                      onClick={() => {
                        setPhase("passkey");
                        void beginPasskeyPrompt();
                      }}
                    >
                      Use a passkey
                    </Button>
                    <Button
                      type="button"
                      className={`w-full ${AUTH_BUTTON_MOTION_CLASS}`}
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setError(null);
                        setPassword("");
                        setPhase("recovery");
                      }}
                    >
                      Recover access
                    </Button>
                  </div>
                ) : phase === "passkey" ? (
                  <div className="grid grid-cols-2 gap-2">
                    <Button
                      type="button"
                      className={`w-full ${AUTH_BUTTON_MOTION_CLASS}`}
                      size="lg"
                      disabled={passkeyPrompting}
                      onClick={beginPasskeyPrompt}
                    >
                      {passkeyPrompting ? "Waiting..." : "Retry passkey"}
                    </Button>
                    <Button
                      type="button"
                      className={`w-full ${AUTH_BUTTON_MOTION_CLASS}`}
                      variant="secondary"
                      size="lg"
                      onClick={handleBackToPassword}
                    >
                      Back
                    </Button>
                  </div>
                ) : phase === "recovery" ? (
                  <div className="grid grid-cols-2 gap-2">
                    <Button
                      type="submit"
                      className={AUTH_BUTTON_MOTION_CLASS}
                      size="lg"
                      disabled={loading || !recoveryCode || !password || !confirmation}
                    >
                      {loading ? "Resetting..." : "Reset access"}
                    </Button>
                    <Button type="button" variant="secondary" size="lg" className={AUTH_BUTTON_MOTION_CLASS} onClick={handleBackToPassword}>
                      Back
                    </Button>
                  </div>
                ) : (
                  <Button type="button" className={`w-full ${AUTH_BUTTON_MOTION_CLASS}`} size="lg" onClick={onLogin}>
                    I saved these codes
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        </form>
      </div>
    </div>
  );
}
