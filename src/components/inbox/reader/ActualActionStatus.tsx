import {
  AlertTriangle,
  CheckCircle2,
  CircleHelp,
  CircleMinus,
  Search,
} from "lucide-react";
import { resolveActualActionStatusView } from "./actualActionStatusModel";
import type { CSSProperties } from "react";
import type { LucideIcon } from "lucide-react";
import type { ActualActionStatusTone, ActualResolutionLike } from "./actualActionStatusModel";

const TONES: Record<ActualActionStatusTone, {
  Icon: LucideIcon;
  color: string;
  border: string;
  background: string;
}> = {
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
  neutral: {
    Icon: CircleMinus,
    color: "var(--sp-blue)",
    border: "color-mix(in srgb, var(--sp-blue) 20%, transparent)",
    background: "color-mix(in srgb, var(--sp-blue) 5%, var(--sp-panel))",
  },
  checking: {
    Icon: Search,
    color: "rgba(205,214,244,0.7)",
    border: "rgba(255,255,255,0.08)",
    background: "color-mix(in srgb, var(--sp-panel) 94%, white 6%)",
  },
  unavailable: {
    Icon: CircleHelp,
    color: "var(--color-text-faint)",
    border: "rgba(255,255,255,0.08)",
    background: "var(--sp-panel)",
  },
};

export default function ActualActionStatus({
  resolution,
  style,
}: {
  resolution: ActualResolutionLike | null | undefined;
  style?: CSSProperties;
}) {
  const view = resolveActualActionStatusView(resolution);
  if (!view) return null;

  const tone = TONES[view.tone];
  const Icon = tone.Icon;
  return (
    <div
      role="status"
      aria-live="polite"
      data-tone={view.tone}
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
      <Icon size={15} color={tone.color} aria-hidden="true" style={{ flexShrink: 0 }} />
      <div style={{ minWidth: 0, lineHeight: 1.35 }}>
        <div style={{ fontSize: 11, fontWeight: 650, color: tone.color }}>
          {view.title}
        </div>
        <div style={{ marginTop: 1, fontSize: 10.5, color: "rgba(205,214,244,0.62)" }}>
          {view.detail}
        </div>
      </div>
    </div>
  );
}
