import { AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";
import { Link } from "react-router";
import type { CSSProperties } from "react";
import type { TransactionImportStatusView as TransactionImportStatusViewModel } from "./transactionImportStatusModel";

const TONES = {
  success: {
    Icon: CheckCircle2,
    color: "var(--sp-green)",
    border: "color-mix(in srgb, var(--sp-green) 24%, transparent)",
    background: "color-mix(in srgb, var(--sp-green) 6%, var(--sp-panel))",
  },
  warning: {
    Icon: AlertTriangle,
    color: "var(--sp-cream)",
    border: "color-mix(in srgb, var(--sp-cream) 24%, transparent)",
    background: "color-mix(in srgb, var(--sp-cream) 6%, var(--sp-panel))",
  },
  danger: {
    Icon: AlertTriangle,
    color: "var(--sp-rose)",
    border: "color-mix(in srgb, var(--sp-rose) 24%, transparent)",
    background: "color-mix(in srgb, var(--sp-rose) 6%, var(--sp-panel))",
  },
  active: {
    Icon: Loader2,
    color: "var(--sp-blue)",
    border: "color-mix(in srgb, var(--sp-blue) 20%, transparent)",
    background: "color-mix(in srgb, var(--sp-blue) 5%, var(--sp-panel))",
  },
};

export function TransactionImportStatusView({
  view,
  style,
}: {
  view: TransactionImportStatusViewModel;
  style?: CSSProperties;
}) {
  const tone = TONES[view.tone];
  const Icon = tone.Icon;

  return (
    <div
      role="status"
      aria-live="polite"
      data-transaction-import-tone={view.tone}
      style={{
        minWidth: 0,
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "9px 12px",
        borderRadius: 10,
        border: `1px solid ${tone.border}`,
        background: tone.background,
        flexShrink: 0,
        ...style,
      }}
    >
      <Icon
        size={15}
        color={tone.color}
        aria-hidden="true"
        className={view.active ? "animate-spin motion-reduce:animate-none" : undefined}
        style={{ flexShrink: 0 }}
      />
      <div style={{ minWidth: 0, flex: 1, lineHeight: 1.35 }}>
        <div style={{ fontSize: 11, fontWeight: 650, color: tone.color }}>{view.title}</div>
        <div style={{ marginTop: 1, fontSize: 10.5, color: "rgba(205,214,244,0.68)" }}>{view.detail}</div>
      </div>
      {view.review ? (
        <Link
          to="/settings?tab=finance#transaction-import-review"
          className="shrink-0 rounded-lg border border-white/[0.08] bg-white/[0.03] px-2.5 py-1.5 text-[10.5px] font-semibold text-foreground outline-none transition-[background-color,border-color,color,transform] duration-200 hover:-translate-y-px hover:border-white/[0.14] hover:bg-white/[0.06] focus-visible:ring-2 focus-visible:ring-primary/60 active:translate-y-0 motion-reduce:transform-none motion-reduce:transition-none"
        >
          Review
        </Link>
      ) : null}
    </div>
  );
}
