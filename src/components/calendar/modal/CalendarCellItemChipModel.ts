import type { CSSProperties } from "react";

export interface CalendarChipLeadingSource {
  leadingLabel?: unknown;
  preserveLeadingLabel?: boolean;
  specialDate?: boolean;
}

export interface CalendarChipPresentationItem extends CalendarChipLeadingSource {
  title?: string;
  accent?: string;
  complete?: boolean;
  quiet?: boolean;
  isGhost?: boolean;
  specialDateAccent?: string;
  recurring?: boolean;
}

export interface CalendarChipPresentationMetrics {
  itemHeight?: number;
}

export interface CalendarChipStyleProjectionOptions {
  item: CalendarChipPresentationItem;
  selected: boolean;
  batchSelected?: boolean;
  pastTone?: string | null;
  active: boolean;
  metrics?: CalendarChipPresentationMetrics;
}

export interface CalendarChipContentFitProjection {
  fontSize: number;
  lineHeight: number;
  lineClamp: number;
}

type CalendarChipLeadingValue = unknown | CalendarChipLeadingSource;

export function compactLeadingLabel(value: unknown): string {
  const label = String(value || "").trim();
  const timeMatch = label.match(/^(\d{1,2})(?::([0-5]\d))?\s*([ap])\.?m\.?$/i);
  if (!timeMatch) return label;
  const hour = timeMatch[1]!;
  const minute = timeMatch[2];
  const suffix = timeMatch[3]!.toLowerCase();
  return minute && minute !== "00" ? `${hour}:${minute}${suffix}` : `${hour}${suffix}`;
}

function isCompactTimeLabel(value: unknown): boolean {
  return /^\d{1,2}(?::[0-5]\d)?[ap]$/i.test(String(value || "").trim());
}

function estimateLeadingLabelWidth(value: CalendarChipLeadingValue): number {
  const source: CalendarChipLeadingSource = value && typeof value === "object"
    ? value as CalendarChipLeadingSource
    : { leadingLabel: value };
  if (source.specialDate) return 0;
  const label = compactLeadingLabel(source.leadingLabel);
  if (!label) return 0;
  const compactTime = isCompactTimeLabel(label);
  const preserve = source.preserveLeadingLabel === true;
  const estimated = Math.ceil(label.length * (compactTime ? 5.8 : preserve ? 6.2 : 5.5));
  if (preserve) return Math.max(24, estimated + 3);
  return Math.max(compactTime ? 22 : 24, Math.min(compactTime ? 56 : 68, estimated));
}

export function getChipLeadingColumnWidth(items: readonly CalendarChipLeadingValue[] = []): number {
  return items.reduce<number>((width, item) => (
    Math.max(width, estimateLeadingLabelWidth(item))
  ), 0);
}

export function projectCalendarChipStyle({
  item,
  selected,
  batchSelected = false,
  pastTone,
  active,
  metrics,
}: CalendarChipStyleProjectionOptions): CSSProperties {
  const ghost = !!item.isGhost;
  const specialDate = item.specialDate === true;
  const accent = specialDate ? item.specialDateAccent || item.accent || "var(--ea-accent)" : item.accent || "var(--ea-accent)";
  const isPast = pastTone === "items";
  const quiet = item.complete || item.quiet;
  const hasMetadata = !!(item.leadingLabel || item.recurring || specialDate);
  const itemHeight = metrics?.itemHeight ?? 24;
  const isLarge = itemHeight >= 28;
  const isMedium = itemHeight >= 26;
  const horizontalPadding = itemHeight >= 36 ? 10 : isLarge ? 9 : isMedium ? 8 : 7;
  const verticalPadding = itemHeight >= 36 ? 4 : itemHeight >= 32 ? 3 : hasMetadata ? 2 : 0;
  const radius = isLarge ? 10 : isMedium ? 9 : 8;

  return {
    position: "relative",
    display: "flex",
    flexDirection: "column",
    alignItems: "stretch",
    justifyContent: "center",
    gap: 0,
    minWidth: 0,
    boxSizing: "border-box",
    overflow: "hidden",
    padding: hasMetadata
      ? `${verticalPadding}px ${horizontalPadding}px`
      : `0 ${horizontalPadding}px`,
    height: itemHeight,
    borderRadius: radius,
    border: specialDate && !ghost
      ? batchSelected
        ? `1px solid color-mix(in srgb, ${accent} 58%, rgba(255,255,255,0.13))`
        : selected
          ? `1px solid color-mix(in srgb, ${accent} 42%, rgba(255,255,255,0.08))`
          : active
            ? `1px solid color-mix(in srgb, ${accent} 28%, rgba(255,255,255,0.08))`
            : `1px solid color-mix(in srgb, ${accent} 16%, rgba(255,255,255,0.045))`
      : ghost
      ? `1px dotted color-mix(in srgb, ${accent} 54%, transparent)`
      : batchSelected
      ? `1px solid color-mix(in srgb, ${accent} 68%, rgba(255,255,255,0.16))`
      : selected
      ? `1px solid color-mix(in srgb, ${accent} 48%, rgba(255,255,255,0.08))`
      : active
        ? "1px solid rgba(255,255,255,0.12)"
      : quiet
        ? "1px solid rgba(255,255,255,0.035)"
        : "1px solid rgba(255,255,255,0.045)",
    background: specialDate && !ghost
      ? selected
        ? `linear-gradient(180deg, color-mix(in srgb, ${accent} 14%, rgba(255,255,255,0.02)), color-mix(in srgb, ${accent} 7%, rgba(22,22,30,0.18)))`
        : active
          ? `linear-gradient(180deg, color-mix(in srgb, ${accent} 10%, rgba(255,255,255,0.02)), color-mix(in srgb, ${accent} 5%, rgba(22,22,30,0.12)))`
          : `linear-gradient(180deg, color-mix(in srgb, ${accent} 7%, rgba(255,255,255,0.018)), rgba(255,255,255,0.018))`
      : batchSelected
      ? `linear-gradient(180deg, color-mix(in srgb, ${accent} 24%, transparent), color-mix(in srgb, ${accent} 10%, rgba(22,22,30,0.2)))`
      : selected
      ? `linear-gradient(180deg, color-mix(in srgb, ${accent} 18%, transparent), color-mix(in srgb, ${accent} 8%, transparent))`
      : active
        ? "rgba(255,255,255,0.065)"
      : quiet
        ? "rgba(255,255,255,0.018)"
        : "rgba(255,255,255,0.03)",
    boxShadow: specialDate && !ghost
      ? selected || active
        ? `inset 0 1px 0 color-mix(in srgb, ${accent} 16%, rgba(255,255,255,0.02))`
        : "none"
      : batchSelected
      ? `inset 0 0 0 1px color-mix(in srgb, ${accent} 30%, transparent), 0 0 0 1px rgba(255,255,255,0.035)`
      : selected
      ? `inset 0 1px 0 color-mix(in srgb, ${accent} 18%, rgba(255,255,255,0.02))`
      : active
        ? "inset 0 1px 0 rgba(255,255,255,0.04)"
        : "none",
    color: selected || batchSelected ? "#f6f7fb" : quiet ? "var(--color-text-faint)" : "rgba(205,214,244,0.78)",
    cursor: ghost ? "default" : "pointer",
    pointerEvents: ghost ? "none" : "auto",
    opacity: isPast ? (selected ? 0.92 : 0.82) : quiet ? 0.88 : 1,
    transition: "background 140ms, border-color 140ms, opacity 140ms, box-shadow 140ms, color 140ms",
    fontFamily: "inherit",
    textAlign: "left",
  };
}

export function projectCalendarChipContentFit(
  item: Pick<CalendarChipPresentationItem, "leadingLabel" | "title" | "specialDate">,
  metrics?: CalendarChipPresentationMetrics,
): CalendarChipContentFitProjection {
  const itemHeight = metrics?.itemHeight ?? 24;
  const compactLabel = compactLeadingLabel(item.leadingLabel);
  const length = [compactLabel, item.title].filter(Boolean).join(" ").trim().length;
  const specialDate = item.specialDate === true;

  if (itemHeight >= 36) {
    if (specialDate) return { fontSize: length <= 58 ? 10.5 : 10, lineHeight: 1.08, lineClamp: 2 };
    if (length <= 22) return { fontSize: 11, lineHeight: 1.08, lineClamp: 1 };
    if (length <= 58) return { fontSize: 10.5, lineHeight: 1.08, lineClamp: 2 };
    return { fontSize: 10, lineHeight: 1.08, lineClamp: 2 };
  }
  if (specialDate && itemHeight >= 32) return { fontSize: 10, lineHeight: 1.06, lineClamp: 2 };
  if (itemHeight >= 32) return { fontSize: length <= 22 ? 10.5 : 10, lineHeight: 1.06, lineClamp: length <= 22 ? 1 : 2 };
  if (itemHeight >= 28) return { fontSize: 10.5, lineHeight: 1.05, lineClamp: 1 };
  if (itemHeight >= 26) return { fontSize: 10.25, lineHeight: 1.05, lineClamp: 1 };
  return { fontSize: 10, lineHeight: 1.05, lineClamp: 1 };
}
