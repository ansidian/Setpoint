// Pure model for the Alfred Panel: maps server SSE run events onto the
// message list, plus copy and row formatters.
// No React, no fetch — everything here is unit-testable.
import type {
  AlfredBreakdownBucket,
  AlfredCalendarProposal,
  AlfredEmailAttachmentRef,
  AlfredItem,
  AlfredItemKind,
  AlfredProvider,
  AlfredRunEvent,
  AlfredToolName,
} from "../../../shared/types/alfred";
import type { NormalizedCalendarEvent } from "../../../shared/types/calendar";
import type { TransactionGroupBy, TransactionSummaryBucket } from "../../../shared/types/transactions";
import { calendarEventDiffersFromProposal } from "./alfredCalendarProposalModel";

export type AlfredToolState = "running" | "done" | "error";
export interface AlfredToolEntry {
  toolId: string;
  name: AlfredToolName;
  state: AlfredToolState;
  summary: string | null;
}

export type AlfredPanelMessage =
  | { id: string; type: "user"; text: string; attachment?: AlfredEmailAttachmentRef; failed?: boolean }
  | { id: string; type: "notice"; text: string }
  | { id: string; type: "error"; text: string }
  | { id: string; type: "say"; text: string; done: boolean; preamble?: boolean }
  | { id: string; type: "tools"; done: boolean; tools: AlfredToolEntry[] }
  | { id: string; type: "rows"; kind: AlfredItemKind; items: AlfredItem[] }
  | { id: string; type: "summary"; total: number; period: { start: string; end: string }; group_by: TransactionGroupBy; buckets: TransactionSummaryBucket[] }
  | { id: string; type: "breakdown"; kind: AlfredItemKind; title: string; caption: string; total: number; buckets: AlfredBreakdownBucket[] }
  | {
      id: string;
      type: "calendar-proposal";
      proposal: AlfredCalendarProposal;
      status: "proposed" | "superseded" | "created";
      handoffError: string | null;
      createdEvent: NormalizedCalendarEvent | null;
      editedInCalendar: boolean;
    };

export type AlfredSuggestionIcon =
  | "sun"
  | "bills"
  | "inbox"
  | "deadlines"
  | "calendar"
  | "search"
  | "summary"
  | "reply"
  | "actions";
export interface AlfredSuggestion { icon: AlfredSuggestionIcon; label: string }

let alfredMsgSeq = 0;
function nextId(): string {
  return `am${++alfredMsgSeq}`;
}

export function formatAlfredModelHint(provider: AlfredProvider, model: string): string {
  const claude = model.match(/^claude-(haiku|sonnet|opus)-(\d+)-(\d+)/i);
  if (claude) {
    const family = `${claude[1]?.[0]?.toUpperCase()}${claude[1]?.slice(1).toLowerCase()}`;
    return `Anthropic · Claude ${family} ${claude[2]}.${claude[3]}`;
  }
  const gpt = model.match(/^gpt-(\d+)[.-](\d+)(?:-([a-z0-9-]+))?/i);
  if (gpt) {
    const suffix = gpt[3]
      ? ` ${gpt[3].split("-").map((part) => `${part[0]?.toUpperCase()}${part.slice(1)}`).join(" ")}`
      : "";
    return `OpenAI · GPT-${gpt[1]}.${gpt[2]}${suffix}`;
  }
  return `${provider === "openai" ? "OpenAI" : "Anthropic"} · ${model}`;
}

const TOOL_RUNNING_LABELS: Partial<Record<AlfredToolName, string>> = {
  search_email: "Searching mail…",
  get_email_body: "Reading message…",
  get_calendar_events: "Checking calendar…",
  get_deadlines: "Checking deadlines…",
  get_upcoming_bills: "Checking bills…",
  show_items: "Gathering rows…",
  search_transactions: "Searching transactions…",
  summarize_transactions: "Tallying transactions…",
  propose_calendar_event: "Preparing event proposal…",
};

export function alfredToolRunningLabel(name: string): string {
  return TOOL_RUNNING_LABELS[name as AlfredToolName] || "Working…";
}

// Coverage-correct suggestions (CONTEXT.md: mail, calendar, deadlines, bills).
export const ALFRED_SUGGESTIONS: AlfredSuggestion[] = [
  { icon: "sun", label: "What's left today?" },
  { icon: "bills", label: "What bills are due in the next two weeks?" },
  { icon: "inbox", label: "Anything in mail that needs me?" },
  { icon: "deadlines", label: "What deadlines are coming up this month?" },
  { icon: "calendar", label: "What's on my calendar tomorrow?" },
  { icon: "search", label: "Find the car insurance renewal email" },
  { icon: "bills", label: "How much did I spend on groceries this month?" },
];

// Common next moves for a deliberately attached email. Alfred may prepare an
// event proposal for the existing Calendar editor, but still cannot save it.
export const ALFRED_EMAIL_SUGGESTIONS: AlfredSuggestion[] = [
  { icon: "summary", label: "Summarize this email" },
  { icon: "inbox", label: "What needs my attention in this email?" },
  { icon: "reply", label: "Draft a reply to this email" },
  { icon: "actions", label: "Pull out action items and deadlines" },
  { icon: "calendar", label: "Schedule this in my calendar" },
  { icon: "calendar", label: "Check this email against my calendar" },
  { icon: "search", label: "Find related messages in my inbox" },
];

function closeOpenSay(messages: AlfredPanelMessage[]): AlfredPanelMessage[] {
  const last = messages[messages.length - 1];
  if (last?.type === "say" && !last.done) {
    return [...messages.slice(0, -1), { ...last, done: true }];
  }
  return messages;
}

// A say closed by a tool_start is a between-tool preamble — Alfred narrating what
// it's about to do, not the final answer. Keep it (so the narration persists in
// the thread like any agentic tool), but tag it `preamble` and mark it done so the
// renderer holds it as quiet prose instead of promoting it to the serif answer
// line. That keeps the narration visible without resurrecting the old "stack of
// ~10 serif pseudo-headers" — only the final answer (a say still open at run_end)
// resolves into the serif title.
function closePreambleSay(messages: AlfredPanelMessage[]): AlfredPanelMessage[] {
  const last = messages[messages.length - 1];
  if (last?.type === "say" && !last.done) {
    return [...messages.slice(0, -1), { ...last, done: true, preamble: true }];
  }
  return messages;
}

// When a fresh narration begins, settle the live tools block it follows so that
// block collapses to its "N steps" disclosure instead of spinning above the new
// prose. With preambles now interleaved, a run produces one tools block per
// narration segment; this is what closes each earlier block as the run moves on.
function settleTrailingTools(messages: AlfredPanelMessage[]): AlfredPanelMessage[] {
  const last = messages[messages.length - 1];
  if (last?.type === "tools" && !last.done) {
    return [...messages.slice(0, -1), { ...last, done: true }];
  }
  return messages;
}

// Settle every still-live tools block so each renders as a collapsed "N steps"
// disclosure. Prior runs' blocks are already done, so this only touches the
// current run's; settling all of them (not just the last) is the backstop that
// keeps an interleaved run from leaving an earlier block spinning. Returns the
// same array reference when nothing changed, preserving memo stability.
function finishTools(messages: AlfredPanelMessage[]): AlfredPanelMessage[] {
  let changed = false;
  const next = messages.map((m) => {
    if (m.type === "tools" && !m.done) { changed = true; return { ...m, done: true }; }
    return m;
  });
  return changed ? next : messages;
}

export function makeUserMessage(text: string, attachment?: AlfredEmailAttachmentRef): AlfredPanelMessage {
  return { id: nextId(), type: "user", text, ...(attachment ? { attachment } : {}) };
}

export function makeAlfredNotice(text: string): AlfredPanelMessage {
  return { id: nextId(), type: "notice", text };
}

export function markAlfredUserMessageFailed(messages: AlfredPanelMessage[], id: string): AlfredPanelMessage[] {
  return messages.map((message) => message.id === id && message.type === "user"
    ? { ...message, failed: true }
    : message);
}

export function applyAlfredEvent(messages: AlfredPanelMessage[], event: AlfredRunEvent): AlfredPanelMessage[] {
  switch (event.type) {
    case "text_delta": {
      const last = messages[messages.length - 1];
      if (last?.type === "say" && !last.done) {
        return [...messages.slice(0, -1), { ...last, text: last.text + event.text }];
      }
      // Ignore a whitespace-only opening delta (models often emit a leading "\n"
      // before the first tool_use): starting a say from it would leave a blank
      // preamble line once a tool_start settles it. Real prose still opens a say.
      if (!event.text || !event.text.trim()) return messages;
      // A fresh narration begins: settle the live tools block it follows (if any)
      // so it collapses behind the new prose instead of spinning above it.
      const settled = settleTrailingTools(messages);
      return [...settled, { id: nextId(), type: "say", text: event.text, done: false }];
    }
    case "tool_start": {
      const trimmed = closePreambleSay(messages);
      const entry: AlfredToolEntry = { toolId: event.tool_id, name: event.name, state: "running", summary: null };
      const last = trimmed[trimmed.length - 1];
      // Merge into the active (not-done) tools block so a whole run's steps
      // coalesce into one disclosure; a done block is a prior run's — start fresh.
      if (last?.type === "tools" && !last.done) {
        return [...trimmed.slice(0, -1), { ...last, tools: [...last.tools, entry] }];
      }
      return [...trimmed, { id: nextId(), type: "tools", done: false, tools: [entry] }];
    }
    case "tool_result": {
      return messages.map((m) => {
        if (m.type !== "tools" || !m.tools.some((t) => t.toolId === event.tool_id)) return m;
        return {
          ...m,
          tools: m.tools.map((t) => (t.toolId === event.tool_id
            ? { ...t, state: event.ok ? "done" : "error", summary: event.summary || null }
            : t)),
        };
      });
    }
    case "rows": {
      return [...closeOpenSay(messages), {
        id: nextId(), type: "rows", kind: event.kind, items: event.items as AlfredItem[],
      }];
    }
    case "summary": {
      return [...closeOpenSay(messages), {
        id: nextId(),
        type: "summary",
        total: event.total,
        period: event.period || {},
        group_by: event.group_by || "category",
        buckets: event.buckets || [],
      }];
    }
    case "breakdown": {
      // The card lists every item inside its buckets, so a prior show_items flat
      // list of the same items would render each row twice (the grouping-question
      // double-render). Drop a prior same-kind rows block this card fully contains;
      // a list of another kind, or one with rows the card lacks, is left untouched.
      const buckets = event.buckets || [];
      const carded = new Set<string>();
      for (const bucket of buckets) {
        for (const item of bucket.items || []) {
          const itemRecord = item as unknown as Record<string, unknown>;
          const id = itemRecord.uid ?? itemRecord.id;
          if (id != null) carded.add(String(id));
        }
      }
      const isAbsorbedRows = (m: AlfredPanelMessage): boolean => m.type === "rows"
        && m.kind === event.kind
        && (m.items || []).length > 0
        && (m.items || []).every((item) => carded.has(String(item?.uid ?? item?.id)));
      const pruned = closeOpenSay(messages).filter((m) => !isAbsorbedRows(m));
      return [...pruned, {
        id: nextId(),
        type: "breakdown",
        kind: event.kind,
        title: event.title || "",
        caption: event.caption || "",
        total: event.total || 0,
        buckets,
      }];
    }
    case "calendar_proposal": {
      if (messages.some((message) => message.type === "calendar-proposal" && message.proposal.id === event.proposal.id)) {
        return messages;
      }
      const settled = closeOpenSay(messages).map((message) => (
        message.type === "calendar-proposal"
        && message.status === "proposed"
        && message.proposal.id === event.proposal.revisionOf
          ? { ...message, status: "superseded" as const, handoffError: null }
          : message
      ));
      return [...settled, {
        id: nextId(),
        type: "calendar-proposal",
        proposal: event.proposal,
        status: "proposed",
        handoffError: null,
        createdEvent: null,
        editedInCalendar: false,
      }];
    }
    case "run_end":
      return finishTools(closeOpenSay(messages));
    case "run_error":
      return [...finishTools(closeOpenSay(messages)), {
        id: nextId(), type: "error", text: event.message || "Alfred could not complete this run.",
      }];
    default:
      return messages;
  }
}

export function setAlfredProposalHandoffError(
  messages: AlfredPanelMessage[],
  proposalId: string,
  error: string | null,
): AlfredPanelMessage[] {
  return messages.map((message) => message.type === "calendar-proposal"
    && message.proposal.id === proposalId
    && message.status === "proposed"
    ? { ...message, handoffError: error }
    : message);
}

export function markAlfredProposalCreated(
  messages: AlfredPanelMessage[],
  proposalId: string,
  event: NormalizedCalendarEvent,
): AlfredPanelMessage[] {
  return messages.map((message) => message.type === "calendar-proposal"
    && message.proposal.id === proposalId
    && message.status === "proposed"
    ? {
        ...message,
        status: "created",
        handoffError: null,
        createdEvent: event,
        editedInCalendar: calendarEventDiffersFromProposal(message.proposal, event),
      }
    : message);
}

export function clearUncreatedAlfredProposals(messages: AlfredPanelMessage[]): AlfredPanelMessage[] {
  return messages.filter((message) => message.type !== "calendar-proposal" || message.status === "created");
}

export function formatAlfredMoney(amount: unknown): string {
  const n = Number(amount);
  if (!Number.isFinite(n)) return "";
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function formatAlfredDate(isoDate: unknown): string {
  if (!isoDate) return "";
  const [y, m, d] = String(isoDate).slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return "";
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// Full absolute date+time for the row tooltip — the relative "Nd ago" label is
// fine at a glance but hides the actual date; this fills it in on hover.
export function formatAlfredAbsolute(iso: string | null | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("en-US", {
    month: "short", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit",
  });
}

export function formatAlfredAgo(iso: string | null | undefined, now = new Date()): string {
  const then = new Date(iso || "").getTime();
  if (!Number.isFinite(then)) return "";
  const mins = Math.max(0, Math.round((now.getTime() - then) / 60000));
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

// Todoist priority: 4 is highest (P1). P4 (priority 1) renders no flag.
export function alfredPriorityLabel(priority: unknown): "P1" | "P2" | "P3" | null {
  const p = Number(priority);
  if (p === 4) return "P1";
  if (p === 3) return "P2";
  if (p === 2) return "P3";
  return null;
}

// Auto-scroll decision (P3-4): the thread should only follow the tail when the
// user is already parked near the bottom, so reading earlier messages mid-stream
// isn't yanked back down. Returns true when the scroll position is within
// `threshold` px of the bottom (or the content doesn't overflow yet).
export function isNearBottom(scrollTop: unknown, clientHeight: unknown, scrollHeight: unknown, threshold = 40): boolean {
  const top = Number(scrollTop) || 0;
  const view = Number(clientHeight) || 0;
  const full = Number(scrollHeight) || 0;
  return full - (top + view) <= threshold;
}

export function spendingBreakdownRows(buckets: TransactionSummaryBucket[] = []): Array<TransactionSummaryBucket & { pct: number; isOther: boolean }> {
  const max = buckets.reduce((m, b) => Math.max(m, Math.abs(Number(b.amount) || 0)), 0);
  return buckets.map((b) => {
    const amount = Number(b.amount) || 0;
    const pct = max > 0 ? (Math.abs(amount) / max) * 100 : 0;
    // "Other" is the rollup label hardcoded in server/transactions/transactions-service.ts;
    // matching it greys that bar. Keep in sync if the service's rollup label ever changes.
    return {
      label: b.label,
      amount,
      count: b.count,
      pct: Math.round(pct * 10) / 10,
      isOther: b.label === "Other",
    };
  });
}

// Count-based twin of spendingBreakdownRows for the group_items breakdown card.
// Buckets arrive server-ordered (count desc, "Other" last); preserve that order
// and only compute the bar percentage + the Other-greying flag.
export function countBreakdownRows(buckets: Array<{ label: string; count: number }> = []): Array<{ label: string; count: number; pct: number; isOther: boolean }> {
  const max = buckets.reduce((m, b) => Math.max(m, Number(b.count) || 0), 0);
  return buckets.map((b) => {
    const count = Number(b.count) || 0;
    const pct = max > 0 ? (count / max) * 100 : 0;
    return {
      label: b.label,
      count,
      pct: Math.round(pct * 10) / 10,
      isOther: b.label === "Other",
    };
  });
}

// Render key for the auto-scroll effect (P3-4): bumps when a new message is
// added OR the last (streaming) say message grows. Keying the effect on this
// instead of running it every render stops keystrokes/unrelated re-renders from
// snapping the thread to the bottom.
export function alfredScrollKey(messages: Array<{ type?: string; text?: unknown; tools?: unknown[] }>): string {
  if (!Array.isArray(messages) || messages.length === 0) return "0";
  const last = messages[messages.length - 1];
  const tailLen = last && "text" in last && typeof last.text === "string" ? last.text.length : 0;
  return `${messages.length}:${tailLen}`;
}
