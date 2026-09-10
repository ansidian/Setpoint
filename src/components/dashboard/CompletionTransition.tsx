import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { Check } from "lucide-react";
import { motion as Motion, usePresence, usePresenceData } from "motion/react";
import useMediaQuery from "../../hooks/useMediaQuery";
import { completionReceiptDuration, heightTransition } from "../../lib/motion";

/** Keep a visual receipt while the existing completion action proceeds immediately. */
export default function CompletionTransition({ children, itemId, completing: completingInPlace = false, horizontal = false, style }: {
  children: ReactNode;
  itemId: string;
  /** Show the same receipt for rows that remain visible after completion. */
  completing?: boolean;
  horizontal?: boolean;
  style?: CSSProperties;
}) {
  const [present, safeToRemove] = usePresence();
  const completedIds = usePresenceData() as readonly string[] | undefined;
  // Freeze the departure reason: a fast refetch can prune the completed id
  // while this retained row is still showing its receipt.
  const [exitReceipt, setExitReceipt] = useState<boolean | null>(null);
  if (present && exitReceipt !== null) setExitReceipt(null);
  if (!present && exitReceipt === null) setExitReceipt(!!completedIds?.includes(itemId));
  const reduced = useMediaQuery("(prefers-reduced-motion: reduce)");
  // The receipt has its own clock, independent of provider/refetch latency.
  // Keep the actual pending flag separate so a slow write still blocks clicks.
  const [receipt, setReceipt] = useState({ itemId, pending: completingInPlace, visible: completingInPlace });
  if (receipt.itemId !== itemId || receipt.pending !== completingInPlace) {
    setReceipt({ itemId, pending: completingInPlace, visible: completingInPlace || (receipt.itemId === itemId && receipt.visible) });
  }
  useEffect(() => {
    if (!receipt.visible) return;
    const timer = window.setTimeout(() => setReceipt(value => ({ ...value, visible: false })), reduced ? 0 : completionReceiptDuration * 1000);
    return () => window.clearTimeout(timer);
  }, [receipt.visible, receipt.itemId, reduced]);
  const completing = receipt.visible || (!present && (exitReceipt ?? !!completedIds?.includes(itemId)));
  const transition = heightTransition(reduced || !completing);
  const receiptDelay = completing && !reduced ? completionReceiptDuration : 0;
  const exitMs = (receiptDelay + transition.duration) * 1000;

  // Activity disconnects Motion's effects when a tab is hidden. Explicit
  // presence ownership resumes removal on return instead of stranding inert DOM.
  useEffect(() => {
    if (present || !safeToRemove) return;
    const timer = window.setTimeout(safeToRemove, exitMs);
    return () => window.clearTimeout(timer);
  }, [present, safeToRemove, exitMs]);

  return (
    <Motion.div
      initial={false}
      animate={present ? { opacity: 1, height: "auto", scale: 1 } : { opacity: 0, ...(horizontal ? { scale: 0.96 } : { height: 0 }) }}
      transition={{ ...transition, delay: present ? 0 : receiptDelay }}
      inert={!present || completing || completingInPlace || undefined}
      data-height-animating={!present && !horizontal && completing && !reduced ? "true" : undefined}
      aria-hidden={!present || undefined}
      style={{ position: "relative", minWidth: 0, overflow: present ? "visible" : "clip", ...style }}
    >
      <Motion.div initial={false} animate={{ opacity: completing ? 0.25 : 1 }} transition={transition}
        style={horizontal ? { display: "flex", flex: 1, minWidth: 0, width: "100%" } : undefined}>
        {children}
      </Motion.div>
      {completing && <Motion.span
        initial={{ opacity: 0, scale: reduced ? 1 : 0.85 }} animate={{ opacity: 1, scale: 1 }}
        transition={transition} aria-hidden="true"
        style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", gap: 5, color: "var(--sp-green)", fontSize: 12, fontWeight: 650, pointerEvents: "none" }}
      ><Check size={16} />Done</Motion.span>}
    </Motion.div>
  );
}
