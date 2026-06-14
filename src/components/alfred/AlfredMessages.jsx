// Alfred Panel message primitives. Inline styles + accent prop, matching the
// design handoff's values and the inbox's literal-rgba convention.
import { useState } from "react";
import {
  AlertCircle,
  ArrowRight,
  Calendar,
  Check,
  CreditCard,
  Flag,
  Inbox,
  RefreshCw,
  Search,
  Sun,
} from "lucide-react";
import {
  ALFRED_MODELS,
  ALFRED_SUGGESTIONS,
  alfredToolRunningLabel,
  splitSayText,
} from "./alfredPanelModel.js";

const dim = "rgba(205,214,244,0.55)";
const dimmer = "rgba(205,214,244,0.4)";
const text = "#cdd6f4";
const mono = "var(--font-mono, 'Fira Code', ui-monospace, monospace)";

export function UserLine({ text: body, accent }) {
  return (
    <div style={{ display: "flex", justifyContent: "flex-end" }}>
      <div style={{
        maxWidth: "85%", padding: "7px 11px", borderRadius: 10,
        background: `${accent}1a`, border: `1px solid ${accent}2e`,
        fontSize: 12, lineHeight: 1.5, color: text,
      }}>{body}</div>
    </div>
  );
}

export function ToolRows({ tools, accent }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3, padding: "1px 2px" }}>
      {tools.map((t) => {
        const running = t.state === "running";
        const failed = t.state === "error";
        const color = failed ? "#f38ba8" : running ? dim : "rgba(205,214,244,0.45)";
        return (
          <div key={t.toolId} style={{
            display: "flex", alignItems: "center", gap: 7, minHeight: 20,
            fontFamily: mono, fontSize: 10, color, transition: "color 150ms ease-out",
          }}>
            <span style={{ display: "inline-flex", width: 12, justifyContent: "center" }}>
              {running
                ? <RefreshCw size={10} color={accent} style={{ animation: "alfred-spin 1s linear infinite" }} />
                : failed
                  ? <AlertCircle size={11} color="#f38ba8" />
                  : <Check size={10} strokeWidth={2.5} color="rgba(166,227,161,0.7)" />}
            </span>
            <span style={{ minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {running ? alfredToolRunningLabel(t.name) : (t.summary || alfredToolRunningLabel(t.name))}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export function SayBlock({ text: body }) {
  const { lead, body: rest } = splitSayText(body);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <div className="ea-display" style={{
        fontSize: 17, lineHeight: 1.3, color: text,
        fontFamily: "var(--serif-choice, 'Instrument Serif', serif)",
      }}>{lead}</div>
      {rest ? (
        <div style={{ fontSize: 11.5, lineHeight: 1.55, color: "rgba(205,214,244,0.72)" }}>{rest}</div>
      ) : null}
    </div>
  );
}

export function ErrorLine({ text: body }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 7,
      fontSize: 11, lineHeight: 1.5, color: "#f38ba8",
    }}>
      <AlertCircle size={11} />
      <span>{body}</span>
    </div>
  );
}

const SUGGESTION_ICONS = {
  sun: Sun, bills: CreditCard, inbox: Inbox, deadlines: Flag, calendar: Calendar, search: Search,
};

export function SuggestionList({ onPick, accent }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
      {ALFRED_SUGGESTIONS.map((s) => (
        <SuggestionRow key={s.label} suggestion={s} onPick={onPick} accent={accent} />
      ))}
    </div>
  );
}

function SuggestionRow({ suggestion, onPick, accent }) {
  const [hover, setHover] = useState(false);
  const IconCmp = SUGGESTION_ICONS[suggestion.icon] || Search;
  return (
    <button
      type="button"
      onClick={() => onPick(suggestion.label)}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "flex", alignItems: "center", gap: 9, width: "100%", minHeight: 32,
        padding: "6px 10px", borderRadius: 9, cursor: "pointer", textAlign: "left",
        background: hover ? "rgba(255,255,255,0.04)" : "transparent",
        border: `1px solid ${hover ? "rgba(255,255,255,0.1)" : "transparent"}`,
        color: hover ? text : "rgba(205,214,244,0.7)",
        fontSize: 12, fontFamily: "inherit", fontWeight: 500,
        transition: "background 150ms ease-out, border-color 150ms ease-out, color 150ms ease-out",
      }}
    >
      <IconCmp size={12} color={hover ? accent : dimmer} />
      <span style={{ flex: 1 }}>{suggestion.label}</span>
      <span style={{ display: "inline-flex", opacity: hover ? 1 : 0, transition: "opacity 150ms ease-out" }}>
        <ArrowRight size={11} color={dimmer} />
      </span>
    </button>
  );
}

export function ModelToggle({ modelKey, onChange, accent }) {
  return (
    <div style={{
      display: "flex", gap: 2, padding: 2, borderRadius: 7,
      background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)",
    }}>
      {ALFRED_MODELS.map((m) => {
        const selected = modelKey === m.key;
        return (
          <button
            key={m.key}
            type="button"
            onClick={() => onChange(m.key)}
            title={m.key === "haiku" ? "Claude Haiku — fastest" : "Claude Sonnet — most capable"}
            style={{
              padding: "2px 8px", borderRadius: 5, border: "none", cursor: "pointer",
              fontSize: 9, fontWeight: 600, letterSpacing: 0.4, textTransform: "capitalize",
              fontFamily: "inherit",
              background: selected ? `${accent}24` : "transparent",
              color: selected ? accent : dimmer,
              transition: "background 150ms ease-out, color 150ms ease-out",
            }}
          >{m.label}</button>
        );
      })}
    </div>
  );
}
