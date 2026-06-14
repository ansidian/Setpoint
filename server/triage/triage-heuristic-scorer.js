import { createTriageDecision } from "./triage-decision-normalize.js";

// Two thresholds carve every email into three bands. This is a scorer, not a
// match/no-match list: there is no "uncaught" bucket — the no-signal default is
// simply the middle band (fyi). Pure function of stable indexed fields:
// deterministic, so the same email always lands in the same lane.
export const HEURISTIC_HIGH = 2;
export const HEURISTIC_LOW = -2;

const BULK_LOCALPARTS = [
  "no-reply", "noreply", "no_reply", "do-not-reply", "donotreply",
  "notifications", "notification", "newsletter", "news", "mailer",
  "updates", "marketing",
];

const BULK_BODY_CUES = [
  "unsubscribe",
  "manage preferences",
  "manage your preferences",
  "view in browser",
  "view this email in your browser",
  "update your email preferences",
];

const IMPORTANT_SUBJECT_CUES = [
  "invoice", "payment", "receipt", "past due", "overdue",
  "security", "verify", "verification", "action required",
  "appointment", "deadline", "due date",
];

function localpart(address) {
  const at = String(address || "").toLowerCase().indexOf("@");
  return at === -1 ? String(address || "").toLowerCase() : String(address).toLowerCase().slice(0, at);
}

function scoreEmail(email) {
  const fromAddress = String(email?.from_address || "").toLowerCase();
  const fromName = String(email?.from_name || "").trim();
  const subject = String(email?.subject || "").toLowerCase();
  // body_text is loaded at the no_model call-site (loadEmailForJob selects
  // i.body_text), so the unsubscribe/bulk cue scans both snippet and full text.
  const body = `${email?.body_snippet || ""} ${email?.body_text || ""}`.toLowerCase();

  let score = 0;
  const signals = [];

  const lp = localpart(fromAddress);
  if (BULK_LOCALPARTS.some((p) => lp === p || lp.startsWith(`${p}.`) || lp.startsWith(`${p}-`) || lp.startsWith(`${p}+`))) {
    score -= 2;
    signals.push("sender_bulk");
  }

  for (const cue of BULK_BODY_CUES) {
    if (body.includes(cue)) {
      score -= 2;
      signals.push("body_bulk");
      break;
    }
  }

  for (const cue of IMPORTANT_SUBJECT_CUES) {
    if (subject.includes(cue)) {
      score += 3;
      signals.push("subject_important");
      break;
    }
  }

  // Personal-sender heuristic: a real display name with no bulk signal at all
  // reads as a human. Suppressed when ANY bulk signal (sender OR body) is
  // present, so a single body unsubscribe cue is not cancelled back into fyi.
  if (fromName && !signals.includes("sender_bulk") && !signals.includes("body_bulk")) {
    score += 1;
    signals.push("sender_personal");
  }

  return { score, signals };
}

function laneForScore(score) {
  if (score >= HEURISTIC_HIGH) return "needs_attention";
  if (score <= HEURISTIC_LOW) return "noise";
  return "fyi";
}

export function heuristicNoModelDecision(email, _opts = {}) {
  try {
    const { score, signals } = scoreEmail(email);
    const lane = laneForScore(score);
    return createTriageDecision({
      lane,
      category: "uncategorized",
      urgency: lane === "needs_attention" ? "normal" : "low",
      escalation_badge: lane === "needs_attention" ? "Needs Review" : null,
      summary: email?.body_snippet || email?.subject || "Review provider message.",
      action: lane === "needs_attention" ? "Review" : "",
      triage_source: "no_model_heuristic",
      last_decision_reason: `heuristic:${lane}:score=${score}:${signals.join(",") || "none"}`,
    });
  } catch {
    // A scorer bug must never recreate the needs_attention pile-up. Fail to fyi.
    return createTriageDecision({
      lane: "fyi",
      category: "uncategorized",
      urgency: "low",
      summary: "Review provider message.",
      triage_source: "no_model_heuristic",
      last_decision_reason: "heuristic_scorer_error",
    });
  }
}
