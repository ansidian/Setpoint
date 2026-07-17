// A 6px status dot. Three states: solid (filled lane/status dot),
// hollow (opened/read — transparent with a tone ring, mirrors the Inbox-peek
// opened dot at Dashboard.dc.html:467-469), and glow (live/needs-you — filled
// with a tone halo + pulse, mirrors the band dot at :77 and the timeline live
// pill at :153). The mockup's tdk-pulse keyframe is not in the app's CSS, so
// this primitive ships its own namespaced keyframe locally — same pattern as
// InboxMountFallback.jsx, with a reduced-motion guard.
export function StatusDot({ tone, state = "solid" }: StatusDotProps) {
  const base: CSSProperties = {
    width: 6,
    height: 6,
    borderRadius: 99,
    flex: "none",
    boxSizing: "border-box",
  };

  let variant: CSSProperties;
  if (state === "hollow") {
    variant = { background: "transparent", border: `1.5px solid ${tone}` };
  } else if (state === "glow") {
    variant = {
      background: tone,
      boxShadow: `0 0 7px ${tone}`,
      animation: "sp-dot-pulse 2.4s ease-in-out infinite",
    };
  } else {
    variant = { background: tone };
  }

  return (
    <>
      {state === "glow" && (
        <style>{`
          @keyframes sp-dot-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.45; } }
          @media (prefers-reduced-motion: reduce) {
            [data-testid="status-dot"] { animation: none !important; }
          }
        `}</style>
      )}
      <span data-testid="status-dot" style={{ ...base, ...variant }} />
    </>
  );
}
import type { CSSProperties } from "react";

export type StatusDotProps = {
  tone: string;
  state?: "solid" | "hollow" | "glow";
};
