import { cn } from "@/lib/utils";
import SwipeToReveal from "../ui/SwipeToReveal";

export function MaybeSwipe({ isMobile, onAction, children }) {
  if (!isMobile) return children;
  return <SwipeToReveal onAction={onAction}>{children}</SwipeToReveal>;
}

export function GhostAction({ onClick, disabled, children, className: cls, active }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "text-[10px] max-sm:text-xs font-medium rounded-md px-2.5 py-1.5 cursor-pointer transition-all duration-150 font-[inherit]",
        active
          ? "text-primary bg-primary/[0.08] border border-primary/20 hover:bg-primary/[0.15] hover:border-primary/30"
          : "text-muted-foreground/40 bg-white/[0.02] border border-white/[0.06] hover:bg-white/[0.05] hover:border-white/10",
        "disabled:opacity-50 disabled:pointer-events-none",
        cls,
      )}
    >
      {children}
    </button>
  );
}

export function ConfirmChip({ label, color, onConfirm, onCancel }) {
  return (
    <div onClick={(e) => e.stopPropagation()} className="flex items-center gap-1.5">
      <button
        className="rounded-md text-[10px] max-sm:text-xs font-semibold px-2.5 py-1 cursor-pointer font-[inherit] transition-all duration-150 hover:brightness-125"
        style={{ color, background: `${color}12`, border: `1px solid ${color}25` }}
        onClick={onConfirm}
      >{label}</button>
      <button
        className="bg-transparent border-none text-muted-foreground/30 cursor-pointer p-1 leading-none rounded transition-colors duration-150 hover:text-muted-foreground/60 hover:bg-white/[0.04]"
        onClick={onCancel}
      >
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </div>
  );
}
