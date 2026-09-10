---
version: 1
slug: "src-components-shell-aianalyticsmodal-tsx"
primary_target: "src/components/shell/AiAnalyticsModal.tsx"
related_targets: ["src/components/shell/analytics/EmailAiUsageSection.tsx","src/components/shell/analytics/AiUsageFailures.tsx","src/components/shell/analytics/TriageAnalyticsSection.tsx","src/components/shell/analytics/FinancialEmailAnalyticsSection.tsx"]
---

## Direction contract

THESIS: Extend the dense Operate analytics modal with trustworthy provider-call accounting, without a dashboard redesign.

OWN-WORLD: Match Alfred and Email Search: tinted metric icons, compact metric tiles, lavender cache panel, and clean breakdown rows within the incumbent dark modal.

STORY: Inspect day-to-day triage and additional financial-email calls separately; distinguish known usage from missing measurements. Evaluation usage is excluded.

FIRST VIEWPORT: Seven-day window, six metric tiles, cache totals, and a compact call breakdown. No context controls or legacy totals. Explanations and per-purpose tokens are disclosed on demand. Mobile controls have 44px targets.

FORM: Precisely scoped extension of the incumbent surface; no concept tournament or seed applies. Hover/focus lift and active press follow existing motion, with reduced-motion opt-out.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Recent failures extension

Recent failures sits below the existing call breakdown when failures exist, showing the latest 20 failed calls per category within the seven-day window. Each call expands to provider diagnostics and selectable call/run IDs. Legacy calls explicitly state that additional diagnostics were not recorded; missing values remain “Unknown” or “Not reported.”

Diagnostic fields use two columns on narrow screens and four at the small breakpoint; summary text wraps. Native details/summary provides keyboard disclosure with 44px targets, visible focus, and existing hover/focus shift and active press motion, respecting reduced motion.

Finish review disposition: ship; no material fixes. This narrow extension introduces no durable visual-system change, so DESIGN.md and its sidecar remain unchanged under the local extension rule.
