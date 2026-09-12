// Alfred Panel message primitives. Inline styles + accent prop, matching the
// design handoff's values and the inbox's literal-rgba convention.
//
// The message leaves are React.memo-wrapped (perf audit fe-alfred::
// every-token-rerenders-whole-thread): applyAlfredEvent keeps untouched message
// objects referentially stable, so memoized leaves skip re-render on every
// streamed token / keystroke and only the active say block re-renders. Props are
// primitive/stable (text, tools, accent, done).
import { memo, useState } from "react";
import AnimatedCollapse from "../shared/AnimatedCollapse";
import type { AlfredSuggestion, AlfredToolEntry } from "./alfredPanelModel";
import {
  AlignLeft,
  AlertCircle,
  ArrowRight,
  Calendar,
  Check,
  ChevronDown,
  ChevronRight,
  CreditCard,
  Flag,
  Inbox,
  ListChecks,
  RefreshCw,
  Reply,
  Search,
  Sun,
} from "lucide-react";
import {
  ALFRED_SUGGESTIONS,
  alfredToolRunningLabel,
} from "./alfredPanelModel";
import type { AlfredEmailAttachmentRef } from "../../../shared/types/alfred";
import { AlfredSentEmailReference } from "./AlfredEmailContext";
import AlfredRichText from "./AlfredRichText";
import type { AlfredWorkMessage } from "./alfredMessagePresentation";

const dimmer = "rgba(205,214,244,0.4)";
const text = "var(--sp-text)";
const mono = "var(--font-mono, 'Fira Code', ui-monospace, monospace)";

export const UserLine = memo(function UserLine({
  text: body,
  accent,
  attachment,
  failed = false,
  onPreviewAttachment,
}: {
  text: string;
  accent: string;
  attachment?: AlfredEmailAttachmentRef;
  failed?: boolean;
  onPreviewAttachment?: (attachment: AlfredEmailAttachmentRef) => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 5 }}>
      {attachment && onPreviewAttachment ? (
        <AlfredSentEmailReference
          attachment={attachment}
          failed={failed}
          onPreview={() => onPreviewAttachment(attachment)}
        />
      ) : null}
      <div style={{
        maxWidth: "85%", padding: "7px 11px", borderRadius: 10,
        background: failed ? "color-mix(in srgb, var(--sp-rose) 6%, transparent)" : `${accent}1a`,
        border: `1px solid ${failed ? "color-mix(in srgb, var(--sp-rose) 28%, transparent)" : `${accent}2e`}`,
        fontSize: 12, lineHeight: 1.5, color: text,
      }}>{body}</div>
    </div>
  );
});

export const NoticeLine = memo(function NoticeLine({ text: body }: { text: string }) {
  return (
    <div role="status" style={{ display: "flex", alignItems: "center", gap: 7, color: "var(--color-text-faint)", fontSize: 9.5, lineHeight: 1.45 }}>
      <AlertCircle size={10} color="var(--sp-blue)" />
      {body}
    </div>
  );
});

export const ToolRows = memo(function ToolRows({ tools, accent, done = false }: { tools: AlfredToolEntry[]; accent: string; done?: boolean }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3, padding: "1px 2px" }}>
      {tools.map((t) => {
        const running = t.state === "running" && !done;
        const incomplete = t.state === "running" && done;
        const failed = t.state === "error";
        const color = failed ? "var(--sp-rose)" : "var(--color-text-faint)";
        return (
          <div key={t.toolId} style={{
            display: "flex", alignItems: "flex-start", gap: 7, minHeight: 20,
            fontFamily: mono, fontSize: 10, lineHeight: 1.6, color, transition: "color 150ms ease-out",
          }}>
            <span style={{ display: "inline-flex", width: 12, flexShrink: 0, paddingTop: 3, justifyContent: "center" }}>
              {running
                ? <RefreshCw size={10} color={accent} style={{ animation: "alfred-spin 1s linear infinite" }} />
                : failed || incomplete
                  ? <AlertCircle size={11} color={color} />
                  : <Check size={10} strokeWidth={2.5} color="color-mix(in srgb, var(--sp-green) 70%, transparent)" />}
            </span>
            <span style={{ minWidth: 0, overflowWrap: "anywhere" }}>
              {incomplete
                ? `${alfredToolRunningLabel(t.name).replace(/…$/, "")} · incomplete`
                : running ? alfredToolRunningLabel(t.name) : (t.summary || alfredToolRunningLabel(t.name))}
            </span>
          </div>
        );
      })}
    </div>
  );
});

export const SayBlock = memo(function SayBlock({ text: body, done, preamble }: { text: string; done?: boolean; preamble?: boolean }) {
  // Progress remains quiet prose. Completed answers preserve the model's
  // explicit formatting without inventing emphasis on the opening sentence.
  if (!done || preamble) {
    return (
      <div
        style={{ fontSize: 11.5, lineHeight: 1.55, color: "rgba(205,214,244,0.6)" }}
      >{body}</div>
    );
  }
  return (
    <div style={{
      fontFamily: "var(--font-sans)",
      fontSize: 12.5,
      fontWeight: 400,
      lineHeight: 1.65,
      letterSpacing: "0.005em",
      color: "rgba(205,214,244,0.86)",
    }}>
      <AlfredRichText text={body} />
    </div>
  );
});

// One disclosure per user turn. Live progress stays open; after completion the
// full ordered history is available alongside the answer and native results.
export const WorkHistory = memo(function WorkHistory({ messages, done, accent }: { messages: AlfredWorkMessage[]; done: boolean; accent: string }) {
  const [open, setOpen] = useState(false);
  const expanded = done ? open : true;
  const tools = messages.flatMap((message) => message.type === "tools" ? message.tools : []);
  const n = tools.length;
  const failures = tools.filter((tool) => tool.state === "error").length;
  const incomplete = done ? tools.filter((tool) => tool.state === "running").length : 0;
  const Chevron = expanded ? ChevronDown : ChevronRight;
  return (
    <div data-alfred-work-history style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
      <button
        type="button"
        className="transition-[color,transform] duration-150 enabled:hover:text-foreground motion-safe:enabled:hover:-translate-y-0.5 motion-safe:focus-visible:-translate-y-0.5 motion-safe:enabled:active:translate-y-0 motion-safe:enabled:active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 motion-reduce:transition-none motion-reduce:transform-none"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={expanded}
        disabled={!done}
        style={{
          display: "inline-flex", alignItems: "center", flexWrap: "wrap", gap: 5, alignSelf: "flex-start",
          minHeight: 28, padding: "4px", background: "transparent", border: "none", textAlign: "left",
          cursor: done ? "pointer" : "default",
          fontFamily: "var(--font-sans)", fontSize: 10.5, color: "var(--sp-text-muted)", borderRadius: 5,
        }}
      >
        <Chevron size={11} />
        {done ? null : (
          <RefreshCw size={10} color={accent} style={{ animation: "alfred-spin 1s linear infinite" }} />
        )}
        <span>{done ? "Work history" : "Working"} · {n} step{n === 1 ? "" : "s"}</span>
        {failures ? <span style={{ color: "var(--sp-rose)" }}>· {failures} failed</span> : null}
        {incomplete ? <span>· {incomplete} incomplete</span> : null}
      </button>
      <AnimatedCollapse open={expanded}>
        <div style={{ display: "grid", gap: 8, padding: "8px 4px 4px" }}>
          {messages.map((message) => message.type === "tools"
            ? <ToolRows key={message.id} tools={message.tools} accent={accent} done={done} />
            : <SayBlock key={message.id} text={message.text} done={message.done} preamble />)}
        </div>
      </AnimatedCollapse>
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
  sun: Sun,
  bills: CreditCard,
  inbox: Inbox,
  deadlines: Flag,
  calendar: Calendar,
  search: Search,
  summary: AlignLeft,
  reply: Reply,
  actions: ListChecks,
};

export function SuggestionList({
  suggestions = ALFRED_SUGGESTIONS,
  onPick,
  accent,
}: {
  suggestions?: AlfredSuggestion[];
  onPick: (label: string) => void;
  accent: string;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {suggestions.map((s) => (
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
      onFocus={() => setHover(true)}
      onBlur={() => setHover(false)}
      className="alfred-suggestion transition-transform duration-150 motion-safe:hover:-translate-y-0.5 motion-safe:active:translate-y-0 motion-safe:active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 motion-reduce:transition-none motion-reduce:transform-none"
      style={{
        display: "flex", alignItems: "center", gap: 9, width: "100%", minHeight: 32,
        padding: "10px 12px", borderRadius: 9, cursor: "pointer", textAlign: "left",
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
