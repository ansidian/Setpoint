import { useState } from "react";
import { Sparkles, X, Copy } from "lucide-react";
import { QuickAction } from "../primitives";

export default function DraftReply({ email, accent, onDiscard }) {
  // Parent keys this on email.id so the initializer runs fresh per email.
  const [text, setText] = useState(email.claude?.draftReply || "");

  // Reply-send is intentionally NOT wired — there is no send-reply endpoint in
  // the app (see audit P1-2). The old "Send" button trashed the email and
  // discarded the typed reply, sending nothing. The primary action now copies
  // the edited draft to the clipboard so it can be pasted into Gmail, and never
  // mutates the email. A future real send would add an onSend prop + endpoint
  // and a separate Send control alongside this Copy action.
  async function handleCopyDraft() {
    try {
      await navigator?.clipboard?.writeText?.(text);
    } catch {
      // Clipboard may be unavailable or permission-denied; dismissing the panel
      // is still non-destructive, so fall through to close either way.
    }
    onDiscard?.();
  }
  return (
    <div
      style={{
        margin: "16px 20px 24px",
        borderRadius: 12, overflow: "hidden",
        background: "rgba(24,24,37,0.6)",
        border: `1px solid ${accent}44`,
        boxShadow: "0 8px 24px rgba(0,0,0,0.25)",
      }}
    >
      <div
        style={{
          display: "flex", alignItems: "center", gap: 8,
          padding: "10px 14px",
          borderBottom: "1px solid rgba(255,255,255,0.05)",
        }}
      >
        <Sparkles size={11} color={accent} />
        <span
          style={{
            fontSize: 10, fontWeight: 700, letterSpacing: 2,
            textTransform: "uppercase", color: accent,
          }}
        >
          Drafted reply
        </span>
        <span style={{ fontSize: 10, color: "rgba(205,214,244,0.5)", marginLeft: 4 }}>
          · Replying to {email.from}
        </span>
        <span style={{ flex: 1 }} />
        <button
          type="button"
          onClick={onDiscard}
          style={{
            background: "transparent", border: "none", cursor: "pointer",
            color: "rgba(205,214,244,0.5)", padding: 4, borderRadius: 4,
            display: "inline-flex", fontFamily: "inherit",
          }}
        >
          <X size={12} />
        </button>
      </div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={4}
        style={{
          width: "100%", background: "transparent", border: "none", outline: "none",
          padding: "12px 14px", resize: "vertical",
          fontFamily: "inherit", fontSize: 13, color: "#cdd6f4", lineHeight: 1.55,
          boxSizing: "border-box",
        }}
      />
      <div
        style={{
          display: "flex", alignItems: "center", gap: 8,
          padding: "8px 14px 10px",
          borderTop: "1px solid rgba(255,255,255,0.04)",
        }}
      >
        <span style={{ flex: 1 }} />
        <QuickAction icon={Copy} label="Copy draft" primary onClick={handleCopyDraft} accent={accent} />
      </div>
    </div>
  );
}
