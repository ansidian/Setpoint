import { createHash } from "crypto";
import { validateInsight, SLOT_REF_REGEX } from "./insight-validator.js";
import { ALLOWED_INSIGHT_ICONS, normalizeInsightIcon } from "./insight-icons.js";

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
// Preferred defaults in order — first available one is used if no model is configured
const PREFERRED_MODELS = [
  "claude-sonnet-4-6",
  "claude-sonnet-4-5-20250514",
  "claude-haiku-4-5-20251001",
];
// Small, fast model used for the single-insight reformatter fallback.
const HAIKU_REFORMATTER_MODEL = "claude-haiku-4-5-20251001";

const TZ = "America/Los_Angeles";

const SYSTEM_PROMPT = `You are a personal executive assistant. You receive emails, calendar events, and academic deadlines. Your job is email triage and bill detection. Weather, calendar, deadlines, CTM data, and cross-source insights are handled elsewhere — do NOT include them in your output.

1. TRIAGE EMAILS: Classify each email's "triage" as "actionable", "fyi", or "noise". Include actionable + fyi in the important array, include noise in a compact noise array (from + subject only) AND count in noise_count. Set urgency: high/medium/low.
   Summary: count each triage category separately — "10 emails across 3 accounts. 4 need attention, 2 FYI, 4 noise." "Need attention" = actionable only. Do NOT count fyi emails as needing attention. No subjects/topics in summary.
   NOISE (ONLY if the sender does NOT match any Email Interest — interests ALWAYS win over noise rules):
   - Marketing, promotions, coupons, deals, loyalty rewards ("earn points", "limited time", "% off")
   - Upsell/cross-sell ("see how much you could save", "upgrade your plan", "you might like")
   - Newsletters and digests the user didn't write or reply to
   - Verification emails (OTP, 2FA, login confirmations)
   - Surveys, feedback requests, NPS scores
   FYI: real account activity, shipping updates, appointment confirmations, statements ready, actual transactions/bills owed.
   ACTIONABLE: requires a response or decision from the user.
   Emails with dollar amounts + merchants are "fyi" ONLY if they represent a real transaction or bill — not ads or promotional offers.
   URGENT FLAGS: For any important email with a hard deadline or time-sensitive date (registration closes, payment due, RSVP by, offer expires, event date with registration cutoff), set urgentFlag: { "label": "Deadline Apr 22", "date": "2026-04-22" }. The label should be concise (2-4 words) and include the date. Only use for real deadlines with specific dates — not marketing urgency ("limited time!", "act now!"). If an email has both an event date and a registration deadline, use the registration deadline.

2. DETECT TRANSACTIONS: Extract financial data from emails about payments, purchases, or subscriptions.
   Receipts (Apple, Google, app stores), order confirmations (Amazon, retailers), autopay notices (credit cards, loans), subscription renewals, and payment reminders are ALL bills — set hasBill: true.
   Extract: payee (short name), amount (number — REQUIRED, look in body_preview if not in subject), due_date (YYYY-MM-DD), type: "transfer" (credit card payments), "bill" (recurring services), "expense" (one-off purchases), "income" (refunds/deposits).
   If the email clearly describes a payment/purchase but the exact amount isn't visible, still set hasBill: true and set amount to 0 — the user can fill it in.
   If budget categories are provided, also set category_id and category_name to the best matching category. Only set these if confident in the match.
   SCHEDULED PAYMENT CROSS-REFERENCE: When Scheduled Payments are provided, compare detected bills against them.
   - Confident 1:1 match (same payee + similar amount within 10% + same week): suppress the bill entirely — do NOT set hasBill or extractedBill. The email is triaged normally but the bill is omitted since the user already has it scheduled.
   - Partial match / discrepancy (payee matches but amount or date differs significantly): keep hasBill: true and note the discrepancy in the action field (e.g., "Xfinity $95.99 — scheduled $89.99").
   - No match: treat as new bill detection, same as usual.

3. AI INSIGHTS ARE RETIRED: Always return aiInsights as an empty array. Do not spend output tokens generating insight prose.
   LEGACY FORMAT NOTES: The aiInsights key remains in the submit_briefing schema only as a temporary compatibility stub.
   Calendar events with "passed": true already ended — skip them. Focus on what's ahead.
   When "Next Week's Calendar" is provided, naturally blend it into insights — reference upcoming events when they connect to today's emails, deadlines, or calendar (e.g., prep needed, follow-ups, busy days ahead). Do not force a separate next-week insight if nothing is noteworthy.

   GROUNDING RULE (absolute):
   - Every insight MUST reference specific items from the provided input. Primary anchors: a particular email, calendar event, or historical context entry. Deadlines, Todoist tasks, and scheduled bills may be referenced ONLY as secondary cross-references (see SINGLE-SOURCE RESTATEMENT BAN below), never as the sole anchor. If an insight cannot point to a specific input item under these rules, do NOT generate it.
   - DO NOT surface holidays, observances, tax deadlines, seasonal reminders, or any "did you know"-style facts from your training data. The user does not need the email AI to remind them that Tax Day, Thanksgiving, Daylight Saving, etc. are approaching. These are BANNED from insights unconditionally — even if they feel helpful. The only exception is if such an event is explicitly mentioned in the input data (e.g., an email about tax filing), in which case reference the email, not the holiday.

   SINGLE-SOURCE RESTATEMENT BAN (absolute):
   - Academic Deadlines, Todoist Tasks, and Scheduled Payments are displayed to the user in their own dedicated UI sections. The user can read them directly. Do NOT generate insights that merely restate, summarize, or make surface-level observations about these items on their own (e.g., "Assignment 3 is due Thu," "You have two deadlines back-to-back," "Spotify renews Tuesday," "Todoist task X is due tomorrow"). These are BANNED — even if grounded in the input.
   - These sources may ONLY appear in an insight when cross-referenced with a DIFFERENT source to reveal something non-obvious: a deadline that conflicts with a calendar event, a bill anomaly vs. historical context, an email that relates to an upcoming deadline, etc. If the insight's value collapses when you remove the cross-reference, don't generate it.
   - When in doubt, prefer fewer insights. It is better to return 2 strong cross-source insights than to pad with single-source restatements. Returning 0 deadline/task/bill insights is correct when no meaningful cross-reference exists.

   TYPED DATE SLOT SYSTEM (for insight text):
   Write insight text using the "template" + "slots" format. Templates MUST NOT contain any relative date words — instead, use {slot_id} placeholders for every date or time reference, and the frontend will render them into natural language based on when the user reads the briefing.

   FORBIDDEN words in template (use a slot instead): today, tomorrow, yesterday, tonight, last night, this morning, this afternoon, this evening, later today, earlier today, this week, this weekend, next week, next Mon/Tue/Wed/Thu/Fri/Sat/Sun, bare weekday names (Mon/Tue/Wed/Thu/Fri/Sat/Sun) on their own or in parentheses next to a slot, in N days, in N weeks, soon. The slot already renders the weekday/relative phrase — do NOT add parenthetical date hints like "(Wed)" or "on Wed" adjacent to a {slot_id}.

   HOW TO REFERENCE DATES:
   - PREFER pre-minted slot IDs from the "Available date slots" section of the user message. Reference them with {slot_id}, e.g., {tk_abc123}. When you reference a pre-minted slot, leave the insight's "slots" object EMPTY ({}).
   - Only MINT a new slot in the insight's "slots" object when referencing a date not present in the pre-minted list (e.g., a computed date like "three days before your flight"). New slot IDs must start with "new_" and contain only lowercase letters, digits, and underscores.
   - A slot has shape { "iso": "YYYY-MM-DD", "time": "HH:MM" }. Time is optional (24-hour format). iso must be a valid calendar date derived from the "Now" block — NEVER from training data.
   - CALENDAR EVENTS — STRICT RULE: For any reference to a calendar event (class meeting, scheduled event, appointment), you MUST use a pre-minted cal_* or nwcal_* slot ID. NEVER mint new_cal_* or new_nwcal_* slots — the iso/time/weekday would be your invention, not the user's actual calendar. If no pre-minted cal_*/nwcal_* slot fits the event you want to mention, do NOT reference that event — pick a different anchor or drop the insight.

   ICON: "icon" MUST be one of these exact strings (case-sensitive, no emojis): ${ALLOWED_INSIGHT_ICONS.join(", ")}. Pick the most semantically appropriate one. When unsure, use "Sparkles" or "Lightbulb".

   EXAMPLES:
   Pre-minted slots available:
     tk_abc = 2026-04-09 (Poo-Pourri task)
     cal_xyz = 2026-04-08 20:00 (The Boys viewing)
     bill_123 = 2026-04-10 (Electric $95.99)

   ✅ CORRECT:
     { "icon": "Film", "template": "The Boys viewing is {cal_xyz}.", "slots": {} }
     { "icon": "Sparkles", "template": "Your Poo-Pourri task is due {tk_abc}.", "slots": {} }
     { "icon": "Lightbulb", "template": "Your electric bill {bill_123} is $12 higher than last month — worth a look.", "slots": {} }
     { "icon": "Plane", "template": "Start packing {new_prep} — three days before your flight.", "slots": { "new_prep": { "iso": "2026-04-18" } } }

   ❌ WRONG — contains forbidden relative word:
     { "template": "Your task is due tomorrow." }  ← use {tk_abc}
     { "template": "The Boys is tonight at 8pm." } ← use {cal_xyz}
     { "template": "Tax Day is next Wed." }        ← no pre-minted slot and not in input → don't mention

   ❌ WRONG — decorative date hint next to a slot (slot already renders the day):
     { "template": "Review the SCE bill {bill_123} (Wed) on Wed." }  ← just "Review the SCE bill {bill_123}."
     { "template": "Spotify renewal {bill_456} (Tue)." }             ← just "Spotify renewal {bill_456}."

   ❌ WRONG — minted a new slot when a pre-minted one exists:
     { "template": "Your task is due {new_task}.", "slots": { "new_task": { "iso": "2026-04-09" } } }
     (Should reference {tk_abc} instead.)

   When Historical Context is provided, USE it:
   - Compare current bills/transactions to historical amounts (note increases, decreases, trends)
   - Flag recurring senders or threads that span multiple briefings
   - Note deadline patterns (submission timing habits, approaching due dates mentioned before)
   - Reference what previous briefings flagged if it connects to today's data
   If no historical context is provided, generate insights from current data only.

RULES (for email triage):
- Group emails by their account_label. Use account_label as "name", account_icon as "icon", account_color as "color".
- "unread" MUST equal the number of emails in "important" whose "read" field is false. Do NOT fabricate emails.
- "read" MUST be passed through from the input email's "read" field as-is.
- Keep output concise — previews under 2 sentences, insights under 3 sentences each.
- When urgentFlag is set, the action field must NOT repeat the deadline — use a verb-only action instead (e.g., "Claim credit", "RSVP", "Register"). The urgentFlag already displays the date.
- If an email is in a non-English language (Chinese, Spanish, etc.), write the preview and action fields in English. Summarize the content — do not translate literally.

You MUST respond by calling the submit_briefing tool. Do not respond with free text.`;

// --- Tool schema for submit_briefing ---
// Forces model output to conform to the slot-system
// contract. tool_choice below makes this the only allowed response path.
const SUBMIT_BRIEFING_TOOL = {
  name: "submit_briefing",
  description: "Submit the daily briefing: email triage results + insight items using the typed date slot system.",
  input_schema: {
    type: "object",
    required: ["aiInsights", "emails"],
    properties: {
      aiInsights: {
        type: "array",
        maxItems: 0,
        description: "Compatibility stub. Must be an empty array; AI Insights are retired.",
        items: {
          type: "object",
          required: ["icon", "template", "slots"],
          properties: {
            icon: {
              type: "string",
              enum: ALLOWED_INSIGHT_ICONS,
              description: "One of the allowed lucide-react icon names.",
            },
            template: {
              type: "string",
              description: "Insight text with {slot_id} placeholders. FORBIDDEN: today, tomorrow, yesterday, tonight, last night, this morning, this afternoon, this evening, earlier today, later today, this week, this weekend, next week, next {weekday}, in N days, soon. Use slot placeholders for all date/time references.",
            },
            slots: {
              type: "object",
              description: "Date slots minted by the model for dates NOT in the pre-minted list. Leave EMPTY when the template only uses pre-minted slot IDs. Keys must start with 'new_'.",
              additionalProperties: {
                type: "object",
                required: ["iso"],
                properties: {
                  iso: {
                    type: "string",
                    description: "Calendar date in PT as YYYY-MM-DD.",
                  },
                  time: {
                    type: "string",
                    description: "Optional 24-hour time as HH:MM.",
                  },
                },
              },
            },
          },
        },
      },
      emails: {
        type: "object",
        required: ["summary", "accounts"],
        properties: {
          summary: { type: "string" },
          accounts: {
            type: "array",
            items: {
              type: "object",
              required: ["name", "icon", "color", "unread", "important", "noise", "noise_count"],
              properties: {
                name: { type: "string" },
                icon: { type: "string" },
                color: { type: "string" },
                unread: { type: "number" },
                important: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      id: { type: "string" },
                      from: { type: "string" },
                      fromEmail: { type: "string" },
                      subject: { type: "string" },
                      preview: { type: "string" },
                      action: { type: "string" },
                      urgency: { type: "string" },
                      date: { type: "string" },
                      read: { type: "boolean" },
                      hasBill: { type: "boolean" },
                      extractedBill: {
                        type: ["object", "null"],
                        properties: {
                          payee: { type: "string" },
                          amount: { type: "number" },
                          due_date: { type: "string" },
                          type: { type: "string" },
                          category_id: { type: ["string", "null"] },
                          category_name: { type: ["string", "null"] },
                        },
                      },
                      urgentFlag: {
                        type: ["object", "null"],
                        properties: {
                          label: { type: "string" },
                          date: { type: "string" },
                        },
                      },
                    },
                  },
                },
                noise: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      id: { type: "string" },
                      from: { type: "string" },
                      subject: { type: "string" },
                    },
                  },
                },
                noise_count: { type: "number" },
              },
            },
          },
        },
      },
    },
  },
};

// --- Slot candidate building ---

// 8-char SHA1 hash of a stable string representation
function hash8(str) {
  return createHash("sha1").update(str).digest("hex").slice(0, 8);
}

// Keep only [a-z0-9_] so IDs match the slot reference regex.
function slugify(str) {
  return String(str).toLowerCase().replace(/[^a-z0-9_]/g, "_").slice(0, 16);
}

// Convert a calendar item's _start/_end (ms) + allDay flag into { iso, time? }.
// All-day events have _start as UTC midnight of the event's date, so we
// format in UTC. Timed events format in PT.
function calendarSlotFromItem(item) {
  const d = new Date(item._start);
  if (item.allDay) {
    const iso = new Intl.DateTimeFormat("en-CA", { timeZone: "UTC" }).format(d);
    return { iso };
  }
  const iso = new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(d);
  const time = new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(d);
  return { iso, time };
}

// Parse CTM/Todoist due_time "H:MM AM/PM" → "HH:MM" 24-hour.
function parseAmPmTime(str) {
  if (!str || typeof str !== "string") return null;
  const m = str.trim().match(/^(\d{1,2}):(\d{2})\s*(am|pm)$/i);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const min = m[2];
  const period = m[3].toLowerCase();
  if (period === "pm" && h !== 12) h += 12;
  if (period === "am" && h === 12) h = 0;
  return `${String(h).padStart(2, "0")}:${min}`;
}

/**
 * Build the pre-minted slot candidate dictionary from briefing input data.
 * Each slot has a stable, content-derived ID plus a human label for the model's
 * reference in the prompt. The frontend renderer consumes only { iso, time }.
 */
export function buildSlotCandidates({
  ctmDeadlines,
  todoistTasks,
  calendar,
  nextWeekCalendar,
  upcomingBills,
}) {
  const slots = {}; // id → { iso, time?, label }

  for (const d of ctmDeadlines || []) {
    if (!d.due_date) continue;
    const id = `ctm_${slugify(d.id || hash8(d.title + d.due_date))}`;
    slots[id] = {
      iso: d.due_date,
      ...(parseAmPmTime(d.due_time) ? { time: parseAmPmTime(d.due_time) } : {}),
      label: `${d.title} (${d.class_name || "deadline"})`,
    };
  }

  for (const t of todoistTasks || []) {
    if (!t.due_date) continue;
    const id = `tk_${slugify(t.id || hash8(t.title + t.due_date))}`;
    slots[id] = {
      iso: t.due_date,
      ...(parseAmPmTime(t.due_time) ? { time: parseAmPmTime(t.due_time) } : {}),
      label: `${t.title}${t.class_name ? ` (${t.class_name})` : ""}`,
    };
  }

  for (const b of upcomingBills || []) {
    if (!b.next_date) continue;
    const id = `bill_${hash8(`${b.payee}|${b.next_date}`)}`;
    slots[id] = {
      iso: b.next_date,
      label: `${b.payee}${typeof b.amount === "number" ? ` $${b.amount.toFixed(2)}` : ""}`,
    };
  }

  for (const e of calendar || []) {
    if (typeof e._start !== "number") continue;
    const data = calendarSlotFromItem(e);
    const id = `cal_${hash8(`${data.iso}|${data.time || ""}|${e.title}`)}`;
    slots[id] = { ...data, label: `${e.title}${e.allDay ? " (all day)" : ""}` };
  }

  for (const e of nextWeekCalendar || []) {
    if (typeof e._start !== "number") continue;
    const data = calendarSlotFromItem(e);
    const id = `nwcal_${hash8(`${data.iso}|${data.time || ""}|${e.title}`)}`;
    slots[id] = { ...data, label: `${e.title}${e.allDay ? " (all day)" : ""}` };
  }

  return slots;
}

// Strip the human `label` field from a slot — model-facing context vs
// stored slot data are different things.
function slotDataOnly(slot) {
  const { iso, time } = slot;
  return time ? { iso, time } : { iso };
}

// --- Now block ---

function buildNowBlock() {
  const nowDate = new Date();
  const fmtDate = (d, opts) => d.toLocaleDateString("en-US", { timeZone: TZ, ...opts });
  const fmtTime = (d) => d.toLocaleTimeString("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit", timeZoneName: "short" });
  const isoInTZ = (d) => {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(d);
    const y = parts.find(p => p.type === "year").value;
    const m = parts.find(p => p.type === "month").value;
    const day = parts.find(p => p.type === "day").value;
    return `${y}-${m}-${day}`;
  };
  const addDays = (d, n) => new Date(d.getTime() + n * 86_400_000);
  const dayLine = (offset) => {
    const d = addDays(nowDate, offset);
    const iso = isoInTZ(d);
    const label = fmtDate(d, { weekday: "long", month: "short", day: "numeric" });
    return `${iso} = ${label}`;
  };
  const block = [
    `Today:    ${dayLine(0)}`,
    `Tomorrow: ${dayLine(1)}`,
    `+2 days:  ${dayLine(2)}`,
    `+3 days:  ${dayLine(3)}`,
    `+4 days:  ${dayLine(4)}`,
    `+5 days:  ${dayLine(5)}`,
    `+6 days:  ${dayLine(6)}`,
    `+7 days:  ${dayLine(7)}`,
    `Current time: ${fmtTime(nowDate)}`,
  ].join("\n");
  return { block, todayIso: isoInTZ(nowDate) };
}

function relLabel(iso, todayIso) {
  if (!iso) return "";
  const target = new Date(iso + "T12:00:00Z");
  const todayMid = new Date(todayIso + "T12:00:00Z");
  const days = Math.round((target - todayMid) / 86_400_000);
  if (days === 0) return " (today)";
  if (days === 1) return " (tomorrow)";
  if (days === -1) return " (yesterday)";
  if (days > 1 && days <= 7) return ` (+${days}d)`;
  if (days < -1 && days >= -7) return ` (${days}d)`;
  return "";
}

// --- Anthropic API call with 429/529 retry ---

async function callAnthropicAPI(body) {
  const maxRetries = 3;
  let res;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body,
    });

    if (res.ok || (res.status !== 429 && res.status !== 529)) break;

    if (attempt < maxRetries) {
      const delay = Math.min(2000 * 2 ** attempt, 30000);
      console.warn(`[EA] Anthropic API returned ${res.status}, retrying in ${delay / 1000}s (attempt ${attempt + 1}/${maxRetries})`);
      await new Promise(r => setTimeout(r, delay));
    }
  }

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Anthropic API error (${res.status}): ${text}`);
  }

  return res.json();
}

function extractToolUseInput(data, toolName) {
  const block = (data.content || []).find(
    c => c.type === "tool_use" && c.name === toolName,
  );
  if (!block || !block.input) {
    const fallbackText = (data.content || []).find(c => c.type === "text")?.text || "";
    throw new Error(
      `Anthropic response missing ${toolName} tool_use block. stop_reason=${data.stop_reason}, text=${fallbackText.slice(0, 200)}`,
    );
  }
  return block.input;
}

// --- Slot resolution and validation pipeline ---

// A new_cal_*/new_nwcal_* slot is a fabrication — the prompts forbid minting
// calendar slots, so if one appears the iso/time/weekday was invented by the
// model rather than derived from real calendar data. Dropping these is
// cheaper than letting a wrong weekday reach the user (see the "Mon class
// rendered as Tue" bug that motivated this check).
const FABRICATED_CAL_SLOT_REGEX = /^new_(?:cal|nwcal)_/;

export function fabricatedCalendarSlotKeys(insight) {
  return Object.keys(insight?.slots || {}).filter(k => FABRICATED_CAL_SLOT_REGEX.test(k));
}

// Resolve slot references: for each {id} in the template, prefer the insight's
// own `slots` entry, then fall back to the pre-minted global dict. Returns a
// clean slots object containing only the referenced slots (no dead weight).
function resolveInsightSlots(insight, preMinted) {
  const template = insight.template || "";
  const refs = [...template.matchAll(SLOT_REF_REGEX)].map(m => m[1]);
  const clean = {};
  for (const ref of refs) {
    if (insight.slots && insight.slots[ref]) {
      clean[ref] = slotDataOnly(insight.slots[ref]);
    } else if (preMinted[ref]) {
      clean[ref] = slotDataOnly(preMinted[ref]);
    }
    // else: unresolved — validator will flag
  }
  return { ...insight, slots: clean };
}

// Format pre-minted slots as a compact reference block for the email AI prompt.
function formatSlotReferenceBlock(preMinted) {
  const entries = Object.entries(preMinted);
  if (entries.length === 0) return "No pre-minted slots.";
  return entries
    .map(([id, slot]) => `${id} = ${slot.iso}${slot.time ? ` ${slot.time}` : ""}${slot.label ? ` (${slot.label})` : ""}`)
    .join("\n");
}

// --- Haiku reformatter (fallback) ---

async function reformatInsightWithHaiku({ brokenInsight, errors, preMinted, nowBlock }) {
  const slotRefs = formatSlotReferenceBlock(preMinted);
  const system = `You convert a broken insight object into the correct typed date slot format. NEVER use relative date words (today, tomorrow, tonight, yesterday, last night, this morning, this afternoon, this evening, this week, next week, in N days, soon, next {weekday}). Always reference dates via {slot_id} placeholders. Prefer pre-minted slot IDs; only mint a new slot (prefixed "new_") if no pre-minted slot fits. NEVER mint new_cal_* or new_nwcal_* slots — calendar events MUST reference a pre-minted cal_*/nwcal_* slot. If the broken insight refers to a calendar event (weekday + time, class meeting, appointment) and no pre-minted cal_*/nwcal_* slot matches that weekday/time, return an empty template to drop the insight (do not attempt to salvage with a minted calendar slot — the weekday is likely hallucinated). Respond with ONLY a JSON object, no commentary.`;

  const user = `## Broken insight (fix this)
${JSON.stringify(brokenInsight)}

## Validation errors
${errors.join("\n")}

## Now
${nowBlock}

## Available pre-minted slots
${slotRefs}

## Output format
Return a single JSON object with the keys: icon (string), template (string), slots (object).
Example:
{ "icon": "📋", "template": "Your task is due {tk_abc}.", "slots": {} }
If the insight cannot be rescued (e.g. references something no longer in scope), return an empty template string: { "icon": "", "template": "", "slots": {} }`;

  const body = JSON.stringify({
    model: HAIKU_REFORMATTER_MODEL,
    max_tokens: 512,
    temperature: 0,
    system,
    messages: [{ role: "user", content: user }],
  });

  const data = await callAnthropicAPI(body);
  const rawText = (data.content || []).find(c => c.type === "text")?.text || "";
  const cleaned = rawText.trim().replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
  try {
    return JSON.parse(cleaned);
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) {
      try { return JSON.parse(match[0]); } catch { /* fall through */ }
    }
    throw new Error(`Haiku reformatter returned unparseable text: ${rawText.slice(0, 200)}`);
  }
}

// --- Main entry point ---

function buildEmailAiRequestContext({
  emails,
  calendar,
  ctmDeadlines,
  todoistTasks,
  emailInterests,
  categories,
  upcomingBills,
  nextWeekCalendar,
}) {
  const { block: nowBlock, todayIso } = buildNowBlock();

  const preMintedSlots = buildSlotCandidates({
    ctmDeadlines, todoistTasks, calendar, nextWeekCalendar, upcomingBills,
  });

  const interestsNote = emailInterests?.length
    ? `\n\n## Email Interests (ABSOLUTE RULE — if sender name contains any of these, classify as "fyi" NOT "noise", even if the email looks promotional)\n${emailInterests.join(", ")}`
    : "";

  const trimmedEmails = emails.map(e => ({
    id: e.id || e.uid,
    from: e.from,
    from_email: e.from_email,
    subject: e.subject,
    body_preview: e.body_preview,
    date: e.date,
    account_label: e.account_label,
    account_icon: e.account_icon,
    account_color: e.account_color,
    read: e.read || false,
  }));

  const calendarSummary = calendar.map(e =>
    `${e.time} ${e.duration} "${e.title}"${e.passed ? " [PASSED]" : ""}${e.flag ? ` [${e.flag}]` : ""}`,
  ).join("; ");

  const nextWeekSummary = nextWeekCalendar?.length
    ? nextWeekCalendar.map(e =>
        `${e.dayLabel} ${e.time} ${e.duration} "${e.title}"${e.flag ? ` [${e.flag}]` : ""}`,
      ).join("; ")
    : "";

  const ctmSummary = ctmDeadlines?.length
    ? ctmDeadlines.map(d => `"${d.title}" due ${d.due_date}${relLabel(d.due_date, todayIso)} ${d.due_time || ""} (${d.class_name}, ${d.points_possible || 0}pts)`).join("; ")
    : "None";

  const todoistSummary = todoistTasks?.length
    ? todoistTasks.map(d => `"${d.title}" due ${d.due_date}${relLabel(d.due_date, todayIso)} ${d.due_time || ""} (${d.class_name})`).join("; ")
    : "None";

  const categoriesNote = categories?.length
    ? `\n\n## Budget Categories (for bill detection — match extractedBill to closest category)\n${categories.flatMap(g => g.categories.map(c => `${c.id}:${c.name}`)).join(", ")}`
    : "";

  const scheduledNote = upcomingBills?.length
    ? `\n\n## Scheduled Payments (from budget app — cross-reference with detected bills)\n${upcomingBills.map(b => `${b.payee} $${b.amount.toFixed(2)} due ${b.next_date}`).join("; ")}`
    : "";

  const slotReferenceBlock = formatSlotReferenceBlock(preMintedSlots);

  const userMessage = `## Now (use these dates for ALL date math — do not rely on training data)
${nowBlock}

## Available date slots (reference these by ID in insight templates; leave the insight's "slots" object empty when using them)
${slotReferenceBlock}

## Emails
${JSON.stringify(trimmedEmails)}

## Today's Calendar (for insights only — do NOT include in output)
${calendarSummary || "No events"}

## Academic Deadlines (for insights only — do NOT include in output)
${ctmSummary}

## Todoist Tasks (for insights only — do NOT include in output)
${todoistSummary}

## Next Week's Calendar (for insights only — do NOT include in output)
${nextWeekSummary || "No events"}${interestsNote}${categoriesNote}${scheduledNote}`;

  return { nowBlock, preMintedSlots, userMessage };
}

async function finalizeEmailAiResult(result, { preMintedSlots, nowBlock }) {
  // --- Insight validation + repair pipeline ---
  const rawInsights = Array.isArray(result.aiInsights) ? result.aiInsights : [];
  const finalInsights = [];

  for (let i = 0; i < rawInsights.length; i++) {
    let insight = resolveInsightSlots(rawInsights[i], preMintedSlots);
    let check = validateInsight(insight);
    let fabricated = fabricatedCalendarSlotKeys(insight);

    if (check.valid && fabricated.length === 0) {
      finalInsights.push(insight);
      continue;
    }

    if (fabricated.length > 0) {
      console.warn(`[EA] Insight ${i} references fabricated calendar slot(s) ${fabricated.join(", ")} — dropping (no reformatter rescue; weekday is likely hallucinated)`);
      continue;
    }

    console.warn(`[EA] Insight ${i} failed validation: ${check.errors.join("; ")} — trying Haiku reformatter`);

    // Fallback: Haiku reformatter. We skip the "targeted re-prompt to the main
    // model" step because (a) the tool-use enforcement already catches shape
    // errors, and (b) in practice the main model either gets it right or it
    // doesn't — a second attempt at the same prompt rarely helps. Haiku on a
    // narrow reformat task is cheaper and more reliable.
    try {
      const reformatted = await reformatInsightWithHaiku({
        brokenInsight: insight,
        errors: check.errors,
        preMinted: preMintedSlots,
        nowBlock,
      });
      // Reformatter may return an empty template to signal "unrecoverable"
      if (reformatted && reformatted.template) {
        const mintedNewSlots = Object.keys(reformatted.slots || {}).filter(k => k.startsWith("new_"));
        if (mintedNewSlots.length > 0) {
          console.warn(`[EA] Haiku reformatter minted new slot(s) for insight ${i}: ${JSON.stringify(mintedNewSlots.map(k => ({ id: k, ...reformatted.slots[k] })))}`);
        }
        const resolved = resolveInsightSlots(reformatted, preMintedSlots);
        const recheck = validateInsight(resolved);
        const reFabricated = fabricatedCalendarSlotKeys(resolved);
        if (recheck.valid && reFabricated.length === 0) {
          finalInsights.push(resolved);
          continue;
        }
        if (reFabricated.length > 0) {
          console.warn(`[EA] Haiku reformatter produced fabricated calendar slot(s) ${reFabricated.join(", ")} for insight ${i} — dropping`);
        } else {
          console.warn(`[EA] Haiku reformatter still invalid for insight ${i}: ${recheck.errors.join("; ")}`);
        }
      } else {
        console.warn(`[EA] Haiku reformatter returned empty template for insight ${i} — dropping`);
      }
    } catch (err) {
      console.warn(`[EA] Haiku reformatter threw for insight ${i}: ${err.message}`);
    }

    // Static fallback: drop the insight rather than render corrupted text.
    // Resolver back-compat still handles any insight with `text` only, but
    // we don't have a reliable `text` to synthesize here.
  }

  // Coerce every insight's icon into the allowed lucide-name set. Covers
  // schema-escapees and any other emoji leakage from the model.
  result.aiInsights = finalInsights.map(i => ({ ...i, icon: normalizeInsightIcon(i.icon) }));
  return result;
}

export async function callEmailAiModel({ provider = "anthropic", ...args }) {
  if (provider === "openai") return callOpenAIEmailAi(args);
  return callAnthropicEmailAi(args);
}

export async function callAnthropicEmailAi({
  model,
  ...args
}) {
  if (!ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY not set");

  const selectedModel = model || PREFERRED_MODELS[0];
  const context = buildEmailAiRequestContext(args);

  console.log(`[EA] Calling Anthropic API with model: ${selectedModel}`);

  const body = JSON.stringify({
    model: selectedModel,
    max_tokens: 16384,
    temperature: 0,
    tools: [SUBMIT_BRIEFING_TOOL],
    tool_choice: { type: "tool", name: "submit_briefing" },
    // cache_control on system caches [tools, system] (tools come first in the
    // cache prefix order). Keeping the marker here preserves the existing cache
    // hit behaviour and also covers the newly-added tool schema.
    system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: context.userMessage }],
  });

  const data = await callAnthropicAPI(body);
  const usage = data.usage || {};
  if (usage.cache_read_input_tokens) {
    console.log(`[EA] Cache hit: ${usage.cache_read_input_tokens} tokens read from cache, ${usage.cache_creation_input_tokens || 0} written`);
  } else if (usage.cache_creation_input_tokens) {
    console.log(`[EA] Cache miss: ${usage.cache_creation_input_tokens} tokens written to cache`);
  }
  console.log(`[EA] Tokens — input: ${usage.input_tokens || "?"}, output: ${usage.output_tokens || "?"}, stop: ${data.stop_reason || "?"}`);

  const result = extractToolUseInput(data, "submit_briefing");
  result.model = data.model || selectedModel;
  result.provider = "anthropic";

  return finalizeEmailAiResult(result, context);
}

async function callOpenAIEmailAi({
  model,
  ...args
}) {
  if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY not set");

  const selectedModel = model || "gpt-5.5";
  const context = buildEmailAiRequestContext(args);

  console.log(`[EA] Calling OpenAI Responses API with model: ${selectedModel}`);

  const apiRes = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: selectedModel,
      instructions: SYSTEM_PROMPT,
      input: context.userMessage,
      max_output_tokens: 12000,
      reasoning: { effort: "low" },
      tools: [
        {
          type: "function",
          name: SUBMIT_BRIEFING_TOOL.name,
          description: SUBMIT_BRIEFING_TOOL.description,
          parameters: SUBMIT_BRIEFING_TOOL.input_schema,
          strict: false,
        },
      ],
      tool_choice: { type: "function", name: SUBMIT_BRIEFING_TOOL.name },
    }),
  });

  if (!apiRes.ok) {
    const text = await apiRes.text();
    throw new Error(`OpenAI Responses API error (${apiRes.status}): ${text}`);
  }

  const data = await apiRes.json();
  const usage = data.usage || {};
  console.log(`[EA] OpenAI tokens — input: ${usage.input_tokens || "?"}, output: ${usage.output_tokens || "?"}, status: ${data.status || "?"}`);

  const result = extractOpenAIFunctionArguments(data, SUBMIT_BRIEFING_TOOL.name);
  result.model = data.model || selectedModel;
  result.provider = "openai";

  return finalizeEmailAiResult(result, context);
}

function extractOpenAIFunctionArguments(data, name) {
  const call = (data.output || []).find((item) => item.type === "function_call" && item.name === name);
  if (!call?.arguments) {
    throw new Error(`OpenAI response did not include ${name} function arguments`);
  }
  try {
    return JSON.parse(call.arguments);
  } catch (err) {
    throw new Error(`OpenAI ${name} arguments were not valid JSON: ${err.message}`);
  }
}
