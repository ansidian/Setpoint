import { createHash } from "crypto";

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
// Preferred defaults in order — first available one is used if no model is configured
const PREFERRED_MODELS = [
  "claude-sonnet-4-6",
  "claude-sonnet-4-5-20250514",
  "claude-haiku-4-5-20251001",
];
const TZ = "America/Los_Angeles";

const SYSTEM_PROMPT = `You are a personal executive assistant. Your job is email triage and bill detection for a private dashboard. Weather, calendar, deadlines, tasks, and cross-source insights are handled elsewhere. Do not include them in your output.

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

3. AI INSIGHTS ARE RETIRED: Always return aiInsights as an empty array. Do not generate insight prose, date slots, icons, or historical-context commentary.

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
  description: "Submit legacy-compatible email triage results.",
  input_schema: {
    type: "object",
    required: ["aiInsights", "emails"],
    properties: {
      aiInsights: {
        type: "array",
        maxItems: 0,
        description: "Compatibility stub. Must be an empty array; AI Insights are retired.",
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

// --- Main entry point ---

function buildEmailAiRequestContext({
  emails,
  emailInterests,
  categories,
  upcomingBills,
}) {
  const { block: nowBlock } = buildNowBlock();

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

  const categoriesNote = categories?.length
    ? `\n\n## Budget Categories (for bill detection — match extractedBill to closest category)\n${categories.flatMap(g => g.categories.map(c => `${c.id}:${c.name}`)).join(", ")}`
    : "";

  const scheduledNote = upcomingBills?.length
    ? `\n\n## Scheduled Payments (from budget app — cross-reference with detected bills)\n${upcomingBills.map(b => `${b.payee} $${b.amount.toFixed(2)} due ${b.next_date}`).join("; ")}`
    : "";

  const userMessage = `## Now (use this for bill due-date normalization)
${nowBlock}

## Emails
${JSON.stringify(trimmedEmails)}${interestsNote}${categoriesNote}${scheduledNote}`;

  return { userMessage };
}

async function finalizeEmailAiResult(result) {
  result.aiInsights = [];
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
