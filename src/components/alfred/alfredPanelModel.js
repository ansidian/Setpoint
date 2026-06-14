// Pure model for the Alfred Panel: maps server SSE run events onto the
// message list, plus the model catalog, copy, and row formatters.
// No React, no fetch — everything here is unit-testable.

let alfredMsgSeq = 0;
function nextId() {
  return `am${++alfredMsgSeq}`;
}

export const ALFRED_MODELS = [
  { key: "haiku", id: "claude-haiku-4-5-20251001", label: "haiku", hint: "claude haiku 4.5" },
  { key: "sonnet", id: "claude-sonnet-4-6", label: "sonnet", hint: "claude sonnet 4.6" },
];

export const DEFAULT_ALFRED_MODEL_KEY = "sonnet";

export function alfredModelByKey(key) {
  return ALFRED_MODELS.find((m) => m.key === key)
    || ALFRED_MODELS.find((m) => m.key === DEFAULT_ALFRED_MODEL_KEY);
}

const TOOL_RUNNING_LABELS = {
  search_email: "Searching mail…",
  get_email_body: "Reading message…",
  get_calendar_events: "Checking calendar…",
  get_deadlines: "Checking deadlines…",
  get_upcoming_bills: "Checking bills…",
  show_items: "Gathering rows…",
};

export function alfredToolRunningLabel(name) {
  return TOOL_RUNNING_LABELS[name] || "Working…";
}

// Coverage-correct suggestions (CONTEXT.md: mail, calendar, deadlines, bills).
export const ALFRED_SUGGESTIONS = [
  { icon: "sun", label: "What's left today?" },
  { icon: "bills", label: "What bills are due in the next two weeks?" },
  { icon: "inbox", label: "Anything in mail that needs me?" },
  { icon: "deadlines", label: "What deadlines are coming up this month?" },
  { icon: "calendar", label: "What's on my calendar tomorrow?" },
  { icon: "search", label: "Find the car insurance renewal email" },
];

function closeOpenSay(messages) {
  const last = messages[messages.length - 1];
  if (last?.type === "say" && !last.done) {
    return [...messages.slice(0, -1), { ...last, done: true }];
  }
  return messages;
}

export function makeUserMessage(text) {
  return { id: nextId(), type: "user", text };
}

export function applyAlfredEvent(messages, event) {
  switch (event.type) {
    case "text_delta": {
      const last = messages[messages.length - 1];
      if (last?.type === "say" && !last.done) {
        return [...messages.slice(0, -1), { ...last, text: last.text + event.text }];
      }
      return [...messages, { id: nextId(), type: "say", text: event.text, done: false }];
    }
    case "tool_start": {
      const closed = closeOpenSay(messages);
      const entry = { toolId: event.tool_id, name: event.name, state: "running", summary: null };
      const last = closed[closed.length - 1];
      if (last?.type === "tools") {
        return [...closed.slice(0, -1), { ...last, tools: [...last.tools, entry] }];
      }
      return [...closed, { id: nextId(), type: "tools", tools: [entry] }];
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
        id: nextId(), type: "rows", kind: event.kind, items: event.items || [],
      }];
    }
    case "run_end":
      return closeOpenSay(messages);
    case "run_error":
      return [...closeOpenSay(messages), {
        id: nextId(), type: "error", text: event.message || "Alfred could not complete this run.",
      }];
    default:
      return messages;
  }
}

// Serif lead = first sentence (handoff: "serif = the assistant speaking",
// one short sentence). Decimal points don't end sentences; ** is stripped
// because the model occasionally emits markdown bold.
export function splitSayText(text) {
  const clean = String(text || "").replace(/\*\*/g, "");
  const sentence = clean.match(/[.!?](\s|$)/);
  const newlineIdx = clean.indexOf("\n");
  let cut = sentence ? sentence.index + 1 : -1;
  if (newlineIdx !== -1 && (cut === -1 || newlineIdx < cut)) cut = newlineIdx;
  if (cut === -1 || cut >= clean.trim().length) {
    return { lead: clean.trim(), body: "" };
  }
  return { lead: clean.slice(0, cut).trim(), body: clean.slice(cut).trim() };
}

export function formatAlfredMoney(amount) {
  const n = Number(amount);
  if (!Number.isFinite(n)) return "";
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function formatAlfredDate(isoDate) {
  if (!isoDate) return "";
  const [y, m, d] = String(isoDate).slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return "";
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// Full absolute date+time for the row tooltip — the relative "Nd ago" label is
// fine at a glance but hides the actual date; this fills it in on hover.
export function formatAlfredAbsolute(iso) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("en-US", {
    month: "short", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit",
  });
}

export function formatAlfredAgo(iso, now = new Date()) {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "";
  const mins = Math.max(0, Math.round((now.getTime() - then) / 60000));
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

// Todoist priority: 4 is highest (P1). P4 (priority 1) renders no flag.
export function alfredPriorityLabel(priority) {
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
export function isNearBottom(scrollTop, clientHeight, scrollHeight, threshold = 40) {
  const top = Number(scrollTop) || 0;
  const view = Number(clientHeight) || 0;
  const full = Number(scrollHeight) || 0;
  return full - (top + view) <= threshold;
}

// Render key for the auto-scroll effect (P3-4): bumps when a new message is
// added OR the last (streaming) say message grows. Keying the effect on this
// instead of running it every render stops keystrokes/unrelated re-renders from
// snapping the thread to the bottom.
export function alfredScrollKey(messages) {
  if (!Array.isArray(messages) || messages.length === 0) return "0";
  const last = messages[messages.length - 1];
  const tailLen = typeof last?.text === "string" ? last.text.length : 0;
  return `${messages.length}:${tailLen}`;
}
