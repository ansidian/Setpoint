// Alfred Panel message primitives. Inline styles + accent prop, matching the
// design handoff's values and the inbox's literal-rgba convention.
//
// The message leaves are React.memo-wrapped (perf audit fe-alfred::
// every-token-rerenders-whole-thread): applyAlfredEvent keeps untouched message
// objects referentially stable, so memoized leaves skip re-render on every
// streamed token / keystroke and only the active say block re-renders. Props are
// primitive/stable (text, tools, accent, done).
import { memo, useMemo, useState } from "react";
import type { AlfredModelKey } from "../../../shared/types/alfred";
import type { AlfredSuggestion, AlfredToolEntry } from "./alfredPanelModel";
import {
  AlertCircle,
  ArrowRight,
  Calendar,
  Check,
  ChevronDown,
  ChevronRight,
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
} from "./alfredPanelModel";

const dimmer = "rgba(205,214,244,0.4)";
const text = "var(--sp-text)";
const mono = "var(--font-mono, 'Fira Code', ui-monospace, monospace)";

export const UserLine = memo(function UserLine({ text: body, accent }: { text: string; accent: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "flex-end" }}>
      <div style={{
        maxWidth: "85%", padding: "7px 11px", borderRadius: 10,
        background: `${accent}1a`, border: `1px solid ${accent}2e`,
        fontSize: 12, lineHeight: 1.5, color: text,
      }}>{body}</div>
    </div>
  );
});

export const ToolRows = memo(function ToolRows({ tools, accent }: { tools: AlfredToolEntry[]; accent: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3, padding: "1px 2px" }}>
      {tools.map((t) => {
        const running = t.state === "running";
        const failed = t.state === "error";
        const color = failed ? "var(--sp-rose)" : "var(--color-text-faint)";
        return (
          <div key={t.toolId} style={{
            display: "flex", alignItems: "center", gap: 7, minHeight: 20,
            fontFamily: mono, fontSize: 10, color, transition: "color 150ms ease-out",
          }}>
            <span style={{ display: "inline-flex", width: 12, justifyContent: "center" }}>
              {running
                ? <RefreshCw size={10} color={accent} style={{ animation: "alfred-spin 1s linear infinite" }} />
                : failed
                  ? <AlertCircle size={11} color="var(--sp-rose)" />
                  : <Check size={10} strokeWidth={2.5} color="color-mix(in srgb, var(--sp-green) 70%, transparent)" />}
            </span>
            <span style={{ minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {running ? alfredToolRunningLabel(t.name) : (t.summary || alfredToolRunningLabel(t.name))}
            </span>
          </div>
        );
      })}
    </div>
  );
});

export const SayBlock = memo(function SayBlock({ text: body, done, preamble }: { text: string; done?: boolean; preamble?: boolean }) {
  // useMemo the lead/body split (perf audit fe-alfred::
  // splitsaytext-rerun-per-delta-quadratic): with the memo wrap above, DONE say
  // blocks never recompute; for the active streaming block this skips the split
  // on render causes unrelated to body. The split itself stays O(n) per delta —
  // inherent to splitting a growing string — but no longer reruns on keystrokes.
  // Hooks run unconditionally (before the streaming branch) so order stays stable
  // when `done` flips false→true on the same block.
  const { lead, body: rest } = useMemo(() => splitSayText(body), [body]);

  // Render quietly as one block — don't promote the first sentence to the serif
  // lead — when the say is either (a) still streaming, or (b) a settled between-
  // tool preamble. A preamble is Alfred narrating what it's about to do; it
  // persists in the thread as plain prose (like any agentic tool) rather than
  // flashing as a header. Rendering it identically to its streaming state means
  // there's no visual jump when the next tool_start settles it. Only the finished
  // answer (done && !preamble) resolves into the serif title line.
  if (!done || preamble) {
    return (
      <div style={{ fontSize: 11.5, lineHeight: 1.55, color: "rgba(205,214,244,0.6)" }}>{body}</div>
    );
  }
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
});

// One run's tool calls, rendered from the same `tools` array as a single
// disclosure with two live phases:
//  • running (done=false): the trail is held open so each step accumulates with
//    its real summary as it finishes (the in-flight one spins), under a live
//    "N steps" count — you watch it build instead of one line flashing past.
//  • settled (done=true): it collapses back to the "N steps" disclosure (unless
//    the owner reopened it), so the provenance ADR 0006 leans on stays one click
//    away instead of dominating the answer.
// `expanded` unifies the two: forced open while running, owner-controlled (and
// collapsed by default) once done.
export const ToolSteps = memo(function ToolSteps({ tools, done, accent }: { tools: AlfredToolEntry[]; done: boolean; accent: string }) {
  const [open, setOpen] = useState(false);
  const expanded = done ? open : true;
  const n = tools.length;
  const Chevron = expanded ? ChevronDown : ChevronRight;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <button
        type="button"
        onClick={done ? () => setOpen((v) => !v) : undefined}
        aria-expanded={expanded}
        aria-disabled={!done}
        style={{
          display: "inline-flex", alignItems: "center", gap: 5, alignSelf: "flex-start",
          padding: "2px 4px", background: "transparent", border: "none",
          cursor: done ? "pointer" : "default",
          fontFamily: mono, fontSize: 10, color: "var(--color-text-faint)", borderRadius: 5,
          transition: "color 150ms ease-out",
        }}
        onMouseEnter={done ? (e) => { e.currentTarget.style.color = text; } : undefined}
        onMouseLeave={done ? (e) => { e.currentTarget.style.color = "var(--color-text-faint)"; } : undefined}
      >
        <Chevron size={11} />
        {done ? null : (
          <RefreshCw size={10} color={accent} style={{ animation: "alfred-spin 1s linear infinite" }} />
        )}
        <span>{n} step{n === 1 ? "" : "s"}</span>
      </button>
      {expanded ? <ToolRows tools={tools} accent={accent} /> : null}
    </div>
  );
});

export const ErrorLine = memo(function ErrorLine({ text: body }: { text: string }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 7,
      fontSize: 11, lineHeight: 1.5, color: "var(--sp-rose)",
    }}>
      <AlertCircle size={11} />
      <span>{body}</span>
    </div>
  );
});

const SUGGESTION_ICONS = {
  sun: Sun, bills: CreditCard, inbox: Inbox, deadlines: Flag, calendar: Calendar, search: Search,
};

export function SuggestionList({ onPick, accent }: { onPick: (label: string) => void; accent: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
      {ALFRED_SUGGESTIONS.map((s) => (
        <SuggestionRow key={s.label} suggestion={s} onPick={onPick} accent={accent} />
      ))}
    </div>
  );
}

function SuggestionRow({ suggestion, onPick, accent }: { suggestion: AlfredSuggestion; onPick: (label: string) => void; accent: string }) {
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

export function ModelToggle({ modelKey, onChange, accent }: { modelKey: AlfredModelKey; onChange: (key: AlfredModelKey) => void; accent: string }) {
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
              color: selected ? accent : "var(--color-text-faint)",
              transition: "background 150ms ease-out, color 150ms ease-out",
            }}
          >{m.label}</button>
        );
      })}
    </div>
  );
}
