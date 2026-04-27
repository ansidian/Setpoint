import React from "react";
import { motion, AnimatePresence } from "motion/react";
import { cn } from "@/lib/utils";

const entranceSpring = { type: "tween" as const, duration: 0.18, ease: [0.16, 1, 0.3, 1] as const };
const exitTween = { type: "tween" as const, duration: 0.16, ease: [0.22, 1, 0.36, 1] as const };
const hoverSpring = { type: "tween" as const, duration: 0.14, ease: [0.22, 1, 0.36, 1] as const };

// Section-level container with stagger
export function MotionSection({
  children,
  className,
  delay = 0,
  loaded = true,
  style,
  ...props
}: {
  children: React.ReactNode;
  className?: string;
  delay?: number;
  loaded?: boolean;
  style?: React.CSSProperties;
} & React.ComponentProps<typeof motion.div>) {
  return (
    <motion.div
      className={cn("mb-6", className)}
      initial={{ opacity: 0, y: 12 }}
      animate={loaded ? { opacity: 1, y: 0 } : { opacity: 0, y: 12 }}
      transition={{ ...entranceSpring, delay: delay / 1000 }}
      style={style}
      {...props}
    >
      {children}
    </motion.div>
  );
}

// Card with hover/tap micro-interactions
export function MotionCard({
  children,
  className,
  onClick,
  interactive = true,
  layout = false,
  ...props
}: {
  children: React.ReactNode;
  className?: string;
  onClick?: (e: React.MouseEvent) => void;
  interactive?: boolean;
  layout?: boolean;
} & Omit<React.ComponentProps<typeof motion.div>, "onClick">) {
  return (
    <motion.div
      className={className}
      onClick={onClick}
      layout={layout}
      whileHover={interactive ? { scale: 1.012, transition: hoverSpring } : undefined}
      whileTap={interactive ? { scale: 0.985 } : undefined}
      {...props}
    >
      {children}
    </motion.div>
  );
}

// List container that staggers children
export function MotionList({
  children,
  className,
  stagger = 0.04,
  loaded = true,
  delay = 0,
}: {
  children: React.ReactNode;
  className?: string;
  stagger?: number;
  loaded?: boolean;
  delay?: number;
}) {
  return (
    <motion.div
      className={className}
      initial="hidden"
      animate={loaded ? "visible" : "hidden"}
      variants={{
        visible: {
          transition: {
            staggerChildren: stagger,
            delayChildren: delay / 1000,
          },
        },
        hidden: {},
      }}
    >
      <AnimatePresence initial={false}>{children}</AnimatePresence>
    </motion.div>
  );
}

// Individual list item with entrance/exit
export function MotionItem({
  children,
  className,
  layoutId,
  onClick,
  ...props
}: {
  children: React.ReactNode;
  className?: string;
  layoutId?: string;
  onClick?: (e: React.MouseEvent) => void;
} & Omit<React.ComponentProps<typeof motion.div>, "onClick">) {
  return (
    <motion.div
      className={className}
      layoutId={layoutId}
      onClick={onClick}
      variants={{
        visible: { opacity: 1, y: 0, transition: entranceSpring },
        hidden: { opacity: 0, y: 8 },
      }}
      exit={{ opacity: 0, x: -20, height: 0, marginBottom: 0, transition: exitTween }}
      {...props}
    >
      {children}
    </motion.div>
  );
}

// Presence wrapper
export function MotionPresence({
  children,
  mode = "popLayout",
}: {
  children: React.ReactNode;
  mode?: "popLayout" | "wait" | "sync";
}) {
  return <AnimatePresence mode={mode}>{children}</AnimatePresence>;
}

// Expandable content wrapper (for CTM expand, email body, etc.)
export function MotionExpand({
  children,
  className,
  isOpen,
}: {
  children: React.ReactNode;
  className?: string;
  isOpen: boolean;
}) {
  return (
    <AnimatePresence initial={false}>
      {isOpen && (
        <motion.div
          className={className}
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          exit={{ opacity: 0, height: 0 }}
          transition={{ duration: 0.25, ease: [0.25, 0.46, 0.45, 0.94] }}
          style={{ overflow: "hidden" }}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// Chevron rotation
export function MotionChevron({
  isOpen,
  className,
  size = 12,
}: {
  isOpen: boolean;
  className?: string;
  size?: number;
}) {
  return (
    <motion.svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      animate={{ rotate: isOpen ? 180 : 0 }}
      transition={{ duration: 0.2, ease: "easeInOut" }}
    >
      <polyline points="6 9 12 15 18 9" />
    </motion.svg>
  );
}
