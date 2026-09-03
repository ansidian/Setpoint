import type { CSSProperties, ReactNode } from "react";
import { AnimatePresence, motion as Motion, useIsPresent, useReducedMotion } from "motion/react";
import { heightTransition } from "@/lib/motion";

/** In-flow disclosure. Put padding/margins on the content, inside this shell. */
type CollapseProps = { open: boolean; children: ReactNode; style?: CSSProperties; className?: string };

export default function AnimatedCollapse({ open, children, style, className }: CollapseProps) {
  return (
    <AnimatePresence initial={false}>
      {open ? <CollapseContent style={style} className={className}>{children}</CollapseContent> : null}
    </AnimatePresence>
  );
}

function CollapseContent({ children, style, className }: Omit<CollapseProps, "open">) {
  const present = useIsPresent();
  const reduce = useReducedMotion();
  return (
    <Motion.div
      initial={{ height: 0 }}
      animate={{ height: "auto" }}
      exit={{ height: 0 }}
      transition={heightTransition(reduce)}
      aria-hidden={!present || undefined}
      inert={!present || undefined}
      className={className}
      style={{ overflow: "hidden", minHeight: 0, ...style }}
    >
      {children}
    </Motion.div>
  );
}
