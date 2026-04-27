import { createPortal } from "react-dom";
import { Sliders, X } from "lucide-react";

function Row({ label, hint, children }) {
  return (
    <div
      style={{
        display: "flex", flexDirection: "column", gap: 6,
        padding: "10px 0",
        borderBottom: "1px solid rgba(255,255,255,0.04)",
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <span
          style={{
            fontSize: 10, fontWeight: 600, letterSpacing: 1.8, textTransform: "uppercase",
            color: "rgba(205,214,244,0.75)",
          }}
        >
          {label}
        </span>
        {hint && (
          <span style={{ fontSize: 10, color: "rgba(205,214,244,0.4)" }}>{hint}</span>
        )}
      </div>
      <div>{children}</div>
    </div>
  );
}

function SegBtn({ value, current, onClick, children, accent }) {
  const active = value === current;
  return (
    <button
      type="button"
      onClick={() => onClick(value)}
      style={{
        flex: 1, padding: "7px 8px",
        background: active ? `${accent}20` : "transparent",
        border: `1px solid ${active ? `${accent}48` : "rgba(255,255,255,0.06)"}`,
        color: active ? accent : "rgba(205,214,244,0.6)",
        fontSize: 10, fontWeight: 600,
        borderRadius: 6, cursor: "pointer", fontFamily: "inherit",
        transition: "all 120ms", whiteSpace: "nowrap",
      }}
    >
      {children}
    </button>
  );
}

function Seg({ value, onChange, options, accent }) {
  return (
    <div style={{ display: "flex", gap: 4 }}>
      {options.map((o) => (
        <SegBtn
          key={o.value}
          value={o.value}
          current={value}
          onClick={onChange}
          accent={accent}
        >
          {o.label}
        </SegBtn>
      ))}
    </div>
  );
}

function Toggle({ value, onChange, accent }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!value)}
      aria-pressed={value}
      style={{
        width: 36, height: 20, borderRadius: 999, padding: 2,
        background: value ? `${accent}66` : "rgba(255,255,255,0.08)",
        border: `1px solid ${value ? `${accent}aa` : "rgba(255,255,255,0.1)"}`,
        cursor: "pointer", transition: "all 150ms",
      }}
    >
      <div
        style={{
          width: 14, height: 14, borderRadius: 999,
          background: value ? accent : "rgba(205,214,244,0.5)",
          transform: value ? "translateX(16px)" : "translateX(0)",
          transition: "transform 150ms",
          boxShadow: "0 1px 3px rgba(0,0,0,0.3)",
        }}
      />
    </button>
  );
}

const ACCENT_SWATCHES = [
  { v: "#cba6da", l: "Lavender" },
  { v: "#89dceb", l: "Sky" },
  { v: "#a6e3a1", l: "Green" },
  { v: "#fab387", l: "Peach" },
  { v: "#f38ba8", l: "Pink" },
];

const SERIF_OPTIONS = [
  { value: "Instrument Serif", label: "Inst." },
  { value: "Fraunces", label: "Fraun." },
  { value: "IBM Plex Serif", label: "Plex" },
];

/**
 * CustomizePanel — floating preferences panel.
 * Formerly called "Tweaks" in the prototype. Renamed for end-user clarity.
 * Shown as a portaled floating card so the parent view stays intact.
 */
export default function CustomizePanel({
  open,
  onClose,
  customize,
  tab,
  isMobile = false,
}) {
  if (!open) return null;
  const {
    accent, serifChoice,
    dashboardLayout, inboxLayout, inboxGrouping,
    density, inboxDensity, aiVerbosity,
    showInsights, showInboxPeek, showPreview, sidebarCompact,
    setKey, reset,
  } = customize;

  return createPortal(
    <div
      style={{
        position: "fixed", right: 20, bottom: 20, zIndex: 100,
        width: 300, maxHeight: "82vh", overflowY: "auto",
        background: "#16161e",
        border: `1px solid ${accent}38`,
        borderRadius: 12,
        boxShadow: "0 20px 60px rgba(0,0,0,0.7), 0 2px 12px rgba(0,0,0,0.3)",
        backdropFilter: "blur(12px)",
        padding: "14px 16px 16px",
        isolation: "isolate",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
        <Sliders size={12} color={accent} />
        <span
          style={{
            fontSize: 11, fontWeight: 700, letterSpacing: 2, textTransform: "uppercase",
            color: accent,
          }}
        >
          Customize
        </span>
        <span style={{ flex: 1 }} />
        <button
          type="button"
          onClick={reset}
          style={{
            background: "transparent", border: "none", cursor: "pointer",
            color: "rgba(205,214,244,0.5)",
            fontSize: 10, fontFamily: "inherit",
            padding: "2px 6px",
          }}
          title="Reset to defaults"
        >
          Reset
        </button>
        <button
          type="button"
          onClick={onClose}
          style={{
            background: "transparent", border: "none", cursor: "pointer",
            color: "rgba(205,214,244,0.5)",
            padding: 2, display: "inline-flex", fontFamily: "inherit",
          }}
        >
          <X size={12} />
        </button>
      </div>

      {tab === "dashboard" && (
        <>
          {!isMobile && (
            <Row label="Dashboard layout">
              <Seg
                value={dashboardLayout}
                onChange={(v) => setKey("dashboardLayout", v)}
                options={[
                  { value: "focus", label: "Focus" },
                  { value: "command", label: "Command" },
                  { value: "paper", label: "Paper" },
                ]}
                accent={accent}
              />
            </Row>
          )}
          {!isMobile && (
            <Row label="Dashboard density">
              <Seg
                value={density}
                onChange={(v) => setKey("density", v)}
                options={[
                  { value: "comfortable", label: "Comfy" },
                  { value: "compact", label: "Compact" },
                ]}
                accent={accent}
              />
            </Row>
          )}
          <Row label="Show signals">
            <Toggle value={showInsights} onChange={(v) => setKey("showInsights", v)} accent={accent} />
          </Row>
          <Row label="Show inbox peek">
            <Toggle value={showInboxPeek} onChange={(v) => setKey("showInboxPeek", v)} accent={accent} />
          </Row>
        </>
      )}

      {tab === "inbox" && (
        <>
          {!isMobile && (
            <Row label="Inbox layout">
              <Seg
                value={inboxLayout}
                onChange={(v) => setKey("inboxLayout", v)}
                options={[
                  { value: "two-pane", label: "Two-pane" },
                  { value: "three-pane", label: "Three-pane" },
                  { value: "list-only", label: "List only" },
                ]}
                accent={accent}
              />
            </Row>
          )}
          {!isMobile && (
            <Row label="Grouping">
              <Seg
                value={inboxGrouping}
                onChange={(v) => setKey("inboxGrouping", v)}
                options={[
                  { value: "swimlanes", label: "Swimlanes" },
                  { value: "flat", label: "Flat" },
                ]}
                accent={accent}
              />
            </Row>
          )}
          {!isMobile && (
            <Row label="Inbox density">
              <Seg
                value={inboxDensity}
                onChange={(v) => setKey("inboxDensity", v)}
                options={[
                  { value: "compact", label: "Compact" },
                  { value: "default", label: "Default" },
                  { value: "comfortable", label: "Comfort" },
                ]}
                accent={accent}
              />
            </Row>
          )}
          <Row label="Briefing detail" hint="how much">
            <Seg
              value={aiVerbosity}
              onChange={(v) => setKey("aiVerbosity", v)}
              options={[
                { value: "minimal", label: "Minimal" },
                { value: "standard", label: "Standard" },
                { value: "full", label: "Full + draft" },
              ]}
              accent={accent}
            />
          </Row>
          {!isMobile && (
            <Row label="Show previews in list">
              <Toggle value={showPreview} onChange={(v) => setKey("showPreview", v)} accent={accent} />
            </Row>
          )}
          {!isMobile && (
            <Row label="Compact sidebar">
              <Toggle value={sidebarCompact} onChange={(v) => setKey("sidebarCompact", v)} accent={accent} />
            </Row>
          )}
        </>
      )}

      <Row label="Accent color">
        <div style={{ display: "flex", gap: 6 }}>
          {ACCENT_SWATCHES.map((c) => (
            <button
              key={c.v}
              type="button"
              title={c.l}
              onClick={() => setKey("accent", c.v)}
              style={{
                width: 22, height: 22, borderRadius: 999,
                background: c.v,
                border: accent === c.v
                  ? "2px solid rgba(255,255,255,0.8)"
                  : "2px solid rgba(255,255,255,0.08)",
                cursor: "pointer",
                boxShadow: accent === c.v ? `0 0 12px ${c.v}80` : "none",
              }}
            />
          ))}
        </div>
      </Row>

      <Row label="Display serif">
        <Seg
          value={serifChoice}
          onChange={(v) => setKey("serifChoice", v)}
          options={SERIF_OPTIONS}
          accent={accent}
        />
      </Row>
    </div>,
    document.body,
  );
}
