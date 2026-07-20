import { useRef, useState } from "react";
import type { FormEvent } from "react";
import { stepUpWithPassword } from "@/auth/securityApi";

type DeferredSensitiveAction = {
  action: () => Promise<void>;
  label: string;
};

export function isPasswordStepUpRequired(error: unknown): boolean {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && (error as { code?: unknown }).code === "PASSWORD_STEP_UP_REQUIRED";
}

export function useSensitiveActionStepUp() {
  const pendingRef = useRef<DeferredSensitiveAction | null>(null);
  const [pendingLabel, setPendingLabel] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function clear() {
    pendingRef.current = null;
    setPendingLabel(null);
    setPassword("");
    setError(null);
  }

  async function run(action: () => Promise<void>, label: string): Promise<boolean> {
    try {
      await action();
      return true;
    } catch (caught) {
      if (!isPasswordStepUpRequired(caught)) throw caught;
      pendingRef.current = { action, label };
      setPendingLabel(label);
      setError(null);
      return false;
    }
  }

  async function unlock(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const pending = pendingRef.current;
    if (!pending || !password || busy) return;
    setBusy(true);
    setError(null);
    try {
      await stepUpWithPassword(password);
      const completed = await run(pending.action, pending.label);
      if (completed) clear();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Password confirmation failed");
    } finally {
      setBusy(false);
    }
  }

  return {
    pendingLabel,
    password,
    setPassword,
    busy,
    error,
    run,
    unlock,
    cancel: clear,
  };
}

export type SensitiveActionStepUpState = ReturnType<typeof useSensitiveActionStepUp>;
