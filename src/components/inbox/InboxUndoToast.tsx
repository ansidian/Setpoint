import { useEffect, useState } from "react";
import { motion as Motion, useReducedMotion } from "motion/react";
import type { MouseEventHandler } from "react";
import type { InboxUndoPresentation } from "./useInboxUndoSlot";
import { motionDuration, motionTransition } from "../../lib/motion";
import useMotionPresence from "../../hooks/useMotionPresence";

export default function InboxUndoToast({ undo, onUndo, accent = "#cba6da" }: {
  undo: InboxUndoPresentation | null;
  onUndo: MouseEventHandler<HTMLButtonElement>;
  accent?: string;
}) {
  const reduceMotion = useReducedMotion() ?? false;
  const rendered = useMotionPresence(Boolean(undo), reduceMotion ? 0 : motionDuration.exit * 1000);
  const [shownUndo, setShownUndo] = useState<InboxUndoPresentation | null>(undo);
  const [hover, setHover] = useState(false);
  useEffect(() => {
    if (!undo) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- retain the last payload while its visual shell exits
    setShownUndo(undo);
  }, [undo]);
  const busy = shownUndo?.status === "undoing";
  const message = busy ? "Undoing..." : shownUndo?.error || shownUndo?.message || "";

  if (!rendered || !shownUndo) return null;

  return (
        <Motion.div
          key={shownUndo.id}
          role="status"
          aria-live="polite"
          aria-hidden={!undo}
          inert={!undo ? true : undefined}
          initial={reduceMotion ? false : { opacity: 0, x: "-50%", y: 8 }}
          animate={{ opacity: undo ? 1 : 0, x: "-50%", y: undo || reduceMotion ? 0 : 6 }}
          transition={motionTransition(reduceMotion, motionDuration.exit)}
          style={{
            position: "absolute",
            left: "50%",
            bottom: 18,
            zIndex: 20,
            display: "flex",
            alignItems: "center",
            gap: 12,
            maxWidth: "min(420px, calc(100% - 32px))",
            minHeight: 42,
            padding: "8px 10px 8px 14px",
            borderRadius: 10,
            border: `1px solid ${shownUndo.error ? "color-mix(in srgb, var(--sp-rose) 32%, transparent)" : "rgba(255,255,255,0.10)"}`,
            background: "var(--sp-panel)",
            color: "var(--sp-text)",
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
              color: shownUndo.error ? "var(--sp-rose)" : "rgba(205,214,244,0.92)",
            }}
          >
            {message}
          </span>
          {undo && !undo.error && (
            <button
              type="button"
              className="toast-undo-button sp-focus-ring"
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
        </Motion.div>
  );
}
