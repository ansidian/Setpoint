/* eslint-disable react-refresh/only-export-components */
import { CheckCircle2, Circle, CircleDashed } from "lucide-react";
import { RailMetaChip } from "../../DetailRailPrimitives.tsx";
import { normalizeStatus, statusLabel } from "./deadlinesModel.ts";
import type { LucideIcon } from "lucide-react";

interface DeadlineStatusMeta {
  normalized: string;
  label: string;
  color: string;
  Icon: LucideIcon;
}

export function getDeadlineStatusMeta(status?: unknown): DeadlineStatusMeta {
  const normalized = normalizeStatus(status);
  if (normalized === "complete") {
    return { normalized, label: statusLabel(normalized), color: "var(--sp-green)", Icon: CheckCircle2 };
  }
  if (normalized === "in_progress") {
    return { normalized, label: statusLabel(normalized), color: "var(--sp-cyan)", Icon: CircleDashed };
  }
  return { normalized, label: statusLabel(normalized), color: "rgba(205,214,244,0.55)", Icon: Circle };
}

export function DeadlineStatusIcon({ status, size = 12, testId }: { status?: unknown; size?: number; testId?: string }) {
  const { Icon, color, label } = getDeadlineStatusMeta(status);

  return (
    <span
      data-testid={testId}
      aria-label={label}
      title={label}
      style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", color }}
    >
      <Icon size={size} color={color} />
    </span>
  );
}

export function DeadlineStatusValue({ status, size = 12, testId }: { status?: unknown; size?: number; testId?: string }) {
  const { label } = getDeadlineStatusMeta(status);

  return (
    <span
      data-testid={testId}
      style={{ display: "inline-flex", alignItems: "center", gap: 6, minWidth: 0 }}
    >
      <DeadlineStatusIcon status={status} size={size} />
      <span>{label}</span>
    </span>
  );
}

export function DeadlineStatusBadge({ status, compact = false, testId }: { status?: unknown; compact?: boolean; testId?: string }) {
  return (
    <RailMetaChip tone="quiet" compact={compact}>
      <DeadlineStatusValue
        status={status}
        size={compact ? 11 : 12}
        testId={testId}
      />
    </RailMetaChip>
  );
}
