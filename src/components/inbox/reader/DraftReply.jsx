import { useState } from "react";
import { Sparkles, X, Send } from "lucide-react";
import { Kbd, QuickAction } from "../primitives";

export default function DraftReply({ email, accent, onSend, onDiscard }) {
  // Parent keys this on email.id so the initializer runs fresh per email.
  const [text, setText] = useState(email.claude?.draftReply || "");
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
        <span style={{ fontSize: 10, color: "rgba(205,214,244,0.4)" }}>
          <Kbd>⌘</Kbd> <Kbd>↵</Kbd>
        </span>
        <QuickAction icon={Send} label="Send" primary onClick={onSend} accent={accent} />
      </div>
    </div>
  );
}
