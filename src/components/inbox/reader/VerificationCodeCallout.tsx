import { useEffect, useRef, useState } from "react";
import { Copy, KeyRound, Trash2 } from "lucide-react";
import type { InboxEmailLike } from "../inboxTypes";
import { resolveVerificationCodeAction, verificationCodeActiveUntilMs } from "./verificationCodeModel";
import "./VerificationCodeCallout.css";

const COPY_ERROR = "Couldn't copy the code. The email was not trashed.";

export default function VerificationCodeCallout({
  email,
  readOnly = false,
  onTrash,
}: {
  email: InboxEmailLike;
  readOnly?: boolean;
  onTrash: () => void;
}) {
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [copying, setCopying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const copyingRef = useRef(false);
  const activeUntilMs = verificationCodeActiveUntilMs(email);
  const action = resolveVerificationCodeAction(email, { nowMs, readOnly, copying });

  useEffect(() => {
    if (activeUntilMs == null) return undefined;
    const delay = Math.min(2_147_483_647, Math.max(0, activeUntilMs - Date.now() + 1));
    const timer = window.setTimeout(() => setNowMs(Date.now()), delay);
    return () => window.clearTimeout(timer);
  }, [activeUntilMs, nowMs]);

  if (!action.visible || !action.code) return null;

  const copyAndTrash = async () => {
    if (copyingRef.current) return;
    const clickAction = resolveVerificationCodeAction(email, {
      nowMs: Date.now(),
      readOnly,
      copying: false,
    });
    if (!clickAction.canActivate || !clickAction.code) {
      setNowMs(Date.now());
      return;
    }

    copyingRef.current = true;
    setCopying(true);
    setError(null);
    try {
      const writeText = typeof navigator === "undefined" ? null : navigator.clipboard?.writeText;
      if (!writeText) throw new Error("Clipboard unavailable");
      await writeText.call(navigator.clipboard, clickAction.code);
      onTrash();
    } catch {
      setError(COPY_ERROR);
    } finally {
      copyingRef.current = false;
      setCopying(false);
    }
  };

  return (
    <section className="verification-code-callout" aria-labelledby="verification-code-heading">
      <div className="verification-code-callout__content">
        <div id="verification-code-heading" className="verification-code-callout__heading">
          <KeyRound size={13} aria-hidden="true" />
          Verification code
        </div>
        <div className="verification-code-callout__code">{action.code}</div>
        <div className="verification-code-callout__detail">
          Copies the code, then moves this email to provider Trash. You can undo it.
        </div>
      </div>
      <button
        type="button"
        className="verification-code-callout__action"
        onClick={copyAndTrash}
        disabled={!action.canActivate}
      >
        <span aria-hidden="true" style={{ display: "inline-flex", alignItems: "center", gap: 2 }}>
          <Copy size={13} />
          <Trash2 size={13} />
        </span>
        {copying ? "Copying…" : "Copy code & trash"}
      </button>
      {error && <p className="verification-code-callout__error" role="alert">{error}</p>}
    </section>
  );
}
