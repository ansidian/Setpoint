import { useState, useRef, useEffect } from "react";
import { Lock } from "lucide-react";
import { login } from "../api";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";

export default function Login({ onLogin }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [locked, setLocked] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    if (!locked) inputRef.current?.focus();
  }, [locked]);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!password || loading || locked) return;
    setLoading(true);

    try {
      await login(password);
      onLogin();
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
      setLoading(false);
    }
  }

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
                src="/ea-dashboard-header-logo-v3.svg"
                alt="EA Dashboard"
                style={{ height: 32, filter: "drop-shadow(0 2px 8px rgba(203,166,218,0.18))" }}
              />
              <div className="text-[11px] font-semibold tracking-[2.5px] uppercase text-muted-foreground">
                Private Access
              </div>
              <CardDescription className="text-[13px] text-muted-foreground/70">
                Enter your password to continue
              </CardDescription>
            </CardHeader>

            <CardContent className="pt-5">
              <div className="space-y-4">
                <div>
                  <label className="mb-1.5 block text-[11px] font-medium tracking-[1.5px] uppercase text-muted-foreground">
                    Password
                  </label>
                  <Input
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

                <Button
                  type="submit"
                  className="w-full"
                  size="lg"
                  disabled={loading || !password || locked}
                >
                  {loading ? "Signing in..." : locked ? "Locked" : "Sign in"}
                </Button>
              </div>
            </CardContent>
          </Card>
        </form>
      </div>
    </div>
  );
}
