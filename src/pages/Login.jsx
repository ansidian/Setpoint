import { useState, useRef, useEffect } from "react";
import { KeyRound, Lock } from "lucide-react";
import {
  login,
  getPasskeyAuthenticationOptions,
  verifyPasskeyAuthentication,
  cancelPasskeyAuthentication,
} from "../api";
import { startPasskeyAuthentication } from "../auth/passkeyBrowser.js";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { publicAssetUrl } from "@/publicAsset";

export default function Login({ onLogin }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [locked, setLocked] = useState(false);
  const [phase, setPhase] = useState("password");
  const [passkeyState, setPasskeyState] = useState("idle");
  const inputRef = useRef(null);
  const passkeyAttemptRef = useRef(0);

  useEffect(() => {
    if (!locked && phase === "password") inputRef.current?.focus();
  }, [locked, phase]);

  async function beginPasskeyPrompt() {
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
      setError(err.message || "Passkey check did not finish");
    }
  }

  async function handleBackToPassword() {
    passkeyAttemptRef.current += 1;
    setLoading(false);
    setPasskeyState("idle");
    setPhase("password");
    setPassword("");
    setError(null);
    await cancelPasskeyAuthentication().catch(() => null);
    inputRef.current?.focus();
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (phase !== "password" || !password || loading || locked) return;
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
      const msg = err.message || "";
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
        style={{ background: "radial-gradient(ellipse at top, #1a1a2a, #0b0b13 60%)" }}
      />

      <div className="flex min-h-[calc(100vh-4rem)] items-center justify-center">
        <form className="w-full max-w-[380px]" onSubmit={handleSubmit}>
          <Card className="bg-card/85 backdrop-blur-[2px]">
            <CardHeader className="items-center gap-3 border-b border-white/[0.04] pb-5 text-center">
              <img
                src={publicAssetUrl("setpoint.svg")}
                alt="Setpoint"
                style={{ height: 32, filter: "drop-shadow(0 2px 8px rgba(203,166,218,0.18))" }}
              />
              <div className="text-[11px] font-semibold tracking-[2.5px] uppercase text-muted-foreground">
                Private Access
              </div>
              <CardDescription className="text-[13px] text-muted-foreground/75">
                Enter your password to continue
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
                ) : (
                  <div className="rounded-lg border border-white/[0.06] bg-white/[0.025] px-3 py-3 text-left">
                    <div className="flex items-start gap-2.5">
                      <span className="mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-lg border border-[#cba6da]/20 bg-[#cba6da]/10 text-[#cba6da]">
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
                )}

                {error ? (
                  <div
                    className={`rounded-lg border px-3 py-2 text-left text-[12px] leading-relaxed ${
                      locked
                        ? "border-[#f9e2af]/20 bg-[#f9e2af]/10 text-[#f9e2af]"
                        : "border-[#f38ba8]/20 bg-[#f38ba8]/10 text-[#f38ba8]"
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
                  <Button
                    type="submit"
                    className="w-full"
                    size="lg"
                    disabled={loading || !password || locked}
                  >
                    {loading ? "Signing in..." : locked ? "Locked" : "Sign in"}
                  </Button>
                ) : (
                  <div className="grid grid-cols-2 gap-2">
                    <Button
                      type="button"
                      className="w-full"
                      size="lg"
                      disabled={passkeyPrompting}
                      onClick={beginPasskeyPrompt}
                    >
                      {passkeyPrompting ? "Waiting..." : "Retry passkey"}
                    </Button>
                    <Button
                      type="button"
                      className="w-full"
                      variant="secondary"
                      size="lg"
                      onClick={handleBackToPassword}
                    >
                      Back
                    </Button>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </form>
      </div>
    </div>
  );
}
