import { useState } from "react";

export default function InboxUndoToast({ undo, onUndo, accent = "#cba6da" }) {
  const [hover, setHover] = useState(false);
  if (!undo) return null;

  const busy = undo.status === "undoing";
  const message = busy ? "Undoing..." : undo.error || undo.message;

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: "absolute",
        left: "50%",
        bottom: 18,
        zIndex: 20,
        transform: "translateX(-50%)",
        display: "flex",
        alignItems: "center",
        gap: 12,
        maxWidth: "min(420px, calc(100% - 32px))",
        minHeight: 42,
        padding: "8px 10px 8px 14px",
        borderRadius: 10,
        border: `1px solid ${undo.error ? "rgba(243,139,168,0.32)" : "rgba(255,255,255,0.10)"}`,
        background: "#16161e",
        color: "#cdd6f4",
        boxShadow: "0 20px 60px rgba(0,0,0,0.55)",
        isolation: "isolate",
      }}
    >
      <span
        style={{
          minWidth: 0,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          fontSize: 12,
          fontWeight: 600,
          color: undo.error ? "#f38ba8" : "rgba(205,214,244,0.92)",
        }}
      >
        {message}
      </span>
      {!undo.error && (
        <button
          type="button"
          disabled={busy}
          onClick={onUndo}
          onMouseEnter={() => setHover(true)}
          onMouseLeave={() => setHover(false)}
          style={{
            height: 28,
            padding: "0 10px",
            borderRadius: 8,
            border: `1px solid ${hover && !busy ? `${accent}66` : `${accent}38`}`,
            background: hover && !busy ? `${accent}20` : `${accent}12`,
            color: busy ? "var(--color-text-faint)" : accent,
            cursor: busy ? "default" : "pointer",
            fontFamily: "inherit",
            fontSize: 11,
            fontWeight: 700,
            transition: "background 160ms ease, border-color 160ms ease, color 160ms ease, transform 160ms ease",
            transform: hover && !busy ? "translateY(-1px)" : "translateY(0)",
          }}
        >
          Undo
        </button>
      )}
    </div>
  );
}
