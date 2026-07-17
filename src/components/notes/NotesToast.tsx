import { useState } from "react";
import type { ComponentType } from "react";
import { Archive, ArchiveRestore, Trash2 } from "lucide-react";
import type { LucideProps } from "lucide-react";

export type NotesToastKind = "archive" | "delete" | "restore";

export interface NotesToastPayload {
  id: string;
  kind: NotesToastKind;
  message: string;
  onUndo?: () => void;
}

interface NotesToastProps {
  toast: NotesToastPayload | null;
  onUndo: () => void;
}

// Kind drives the icon + color so archive / delete / restore read differently at a
// glance — the whole point of the toast (you couldn't tell them apart before).
const KINDS = {
  archive: { Icon: Archive, color: "var(--sp-accent)" },
  delete: { Icon: Trash2, color: "var(--sp-rose)" },
  restore: { Icon: ArchiveRestore, color: "var(--sp-green)" },
} satisfies Record<NotesToastKind, { Icon: ComponentType<LucideProps>; color: string }>;

export default function NotesToast({ toast, onUndo }: NotesToastProps) {
  const [hover, setHover] = useState(false);
  if (!toast) return null;
  const { Icon, color } = KINDS[toast.kind];

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
        border: "1px solid rgba(255,255,255,0.10)",
        background: "var(--sp-panel)",
        color: "var(--sp-text)",
        boxShadow: "0 20px 60px rgba(0,0,0,0.55)",
        isolation: "isolate",
      }}
    >
      <Icon size={15} strokeWidth={2} style={{ color, flexShrink: 0 }} aria-hidden="true" />
      <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 12, fontWeight: 600, color: "rgba(205,214,244,0.92)" }}>
        {toast.message}
      </span>
      {toast.onUndo && (
        <button
          type="button"
          onClick={onUndo}
          onMouseEnter={() => setHover(true)}
          onMouseLeave={() => setHover(false)}
          style={{
            height: 28,
            padding: "0 10px",
            borderRadius: 8,
            border: `1px solid ${hover ? `color-mix(in srgb, ${color} 40%, transparent)` : `color-mix(in srgb, ${color} 22%, transparent)`}`,
            background: hover ? `color-mix(in srgb, ${color} 13%, transparent)` : `color-mix(in srgb, ${color} 7%, transparent)`,
            color,
            cursor: "pointer",
            fontFamily: "inherit",
            fontSize: 11,
            fontWeight: 700,
            transition: "background 160ms ease, border-color 160ms ease, transform 160ms ease",
            transform: hover ? "translateY(-1px)" : "translateY(0)",
          }}
        >
          Undo
        </button>
      )}
    </div>
  );
}
